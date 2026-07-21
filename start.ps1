$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonExe = 'D:\yzylauncher-win-Indextts20-260616\win-unpacked\python\build_venv\python.exe'
$configPath = Join-Path $appDir 'config.txt'

if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw "IndexTTS Python was not found: $pythonExe"
}
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Configuration file was not found: $configPath"
}

$configText = Get-Content -LiteralPath $configPath -Raw
$serverHost = [regex]::Match($configText, '(?m)^\s*host\s*=\s*([^\r\n#;]+)').Groups[1].Value.Trim()
$portText = [regex]::Match($configText, '(?m)^\s*port\s*=\s*(\d+)').Groups[1].Value
if ($serverHost -ne '127.0.0.1' -or -not $portText) {
    throw 'config.txt [server] must contain host = 127.0.0.1 and a valid port.'
}

$serverPort = [int]$portText
if (Get-NetTCPConnection -LocalPort $serverPort -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $serverPort is already in use. Close the existing server before starting again."
}

Set-Location -LiteralPath $appDir
$env:PYTHONUNBUFFERED = '1'
$env:AI_VOICE_CHAT_LOG_LEVEL = 'DEBUG'
$url = "http://${serverHost}:$serverPort"
Write-Host ''
Write-Host '============================================================'
Write-Host ' AI Voice Chat is starting. Logs will be shown in this window.'
Write-Host " Open in browser: $url"
Write-Host ' Press Ctrl+C to stop the server.'
Write-Host '============================================================'
Write-Host ''

# Do not open the browser merely because the Python process has started. Wait
# until FastAPI can answer a real request, then give its static files a short
# extra moment to settle. This avoids the first-tab "page not responding" race.
$browserJob = Start-Job -ScriptBlock {
    param($targetUrl)
    $healthUrl = "$targetUrl/api/status"
    $deadline = (Get-Date).AddSeconds(45)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                $ready = $true
                break
            }
        } catch {
        }
        Start-Sleep -Milliseconds 500
    }
    if ($ready) {
        Start-Sleep -Seconds 3
        Start-Process $targetUrl
    }
} -ArgumentList $url

try {
    & $pythonExe -u -m uvicorn app:app --app-dir $appDir --host $serverHost --port $serverPort --log-level debug --access-log
} finally {
    Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
}
