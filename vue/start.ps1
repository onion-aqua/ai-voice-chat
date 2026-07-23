$ErrorActionPreference = 'Stop'

$vueDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $vueDir
$configPath = Join-Path $vueDir 'runtime\config.txt'

if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Vue configuration was not found: $configPath"
}

$configText = Get-Content -LiteralPath $configPath -Raw
$projectHome = [regex]::Match($configText, '(?m)^\s*project_home\s*=\s*([^\r\n#;]+)').Groups[1].Value.Trim()
$serverHost = [regex]::Match($configText, '(?m)^\s*host\s*=\s*([^\r\n#;]+)').Groups[1].Value.Trim()
$portText = [regex]::Match($configText, '(?m)^\s*port\s*=\s*(\d+)').Groups[1].Value

if (-not $projectHome -or -not $portText) {
    throw 'runtime/config.txt must contain [index_tts] project_home and [server] port.'
}
if (-not $serverHost) { $serverHost = '127.0.0.1' }

$pythonExe = Join-Path $projectHome 'build_venv\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw "IndexTTS Python was not found: $pythonExe"
}

$serverPort = [int]$portText
$env:VITE_BACKEND_URL = "http://${serverHost}:$serverPort"

if (-not (Get-NetTCPConnection -LocalPort $serverPort -State Listen -ErrorAction SilentlyContinue)) {
    $backendCommand = "set `"AI_VOICE_CHAT_CONFIG=$configPath`" && `"$pythonExe`" -u -m uvicorn app:app --app-dir `"$appDir`" --host $serverHost --port $serverPort --log-level debug --access-log"
    Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', $backendCommand) -WorkingDirectory $appDir | Out-Null
    Write-Host "Started FastAPI in a separate CMD window: http://${serverHost}:$serverPort"
} else {
    Write-Host "FastAPI is already listening on http://${serverHost}:$serverPort"
}

if (-not (Test-Path -LiteralPath (Join-Path $vueDir 'node_modules'))) {
    Write-Host 'Installing Vue dependencies...'
    Push-Location $vueDir
    try { & npm.cmd install } finally { Pop-Location }
}

$browserJob = Start-Job -ScriptBlock {
    param($apiUrl)
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        try {
            $apiReady = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "$apiUrl/api/status").StatusCode -eq 200
            $viteReady = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri 'http://127.0.0.1:5173').StatusCode -eq 200
            if ($apiReady -and $viteReady) { Start-Process 'http://127.0.0.1:5173'; break }
        } catch {
        }
        Start-Sleep -Milliseconds 500
    }
} -ArgumentList "http://${serverHost}:$serverPort"

Write-Host 'Vue development server logs are shown below. Press Ctrl+C to stop Vite.'
Push-Location $vueDir
try {
    & npm.cmd run dev
} finally {
    Pop-Location
    Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
}
