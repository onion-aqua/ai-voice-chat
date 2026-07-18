# AI 语音聊天

这是一个本地网页聊天应用，复用 `D:\yzylauncher-win-Indextts20-260616` 中的 IndexTTS2 模型和预设音色。

核心规则是：后端先合成每个回答片段的 WAV 文件，再将“文字 + 音频地址”同时发送给浏览器。因此页面不会先显示一段没有语音的回答；浏览器收到片段后会立即按顺序播放。

## 启动

1. 先复制 `config.example.txt` 为 `config.txt`，再填写自己的聊天服务信息；LM Studio 可将 `api_key` 留空。

2. 双击 `start.bat`，或在该窗口运行：

```powershell
.\start.ps1
```

3. 会打开一个 CMD 日志窗口并自动打开网页。聊天、IndexTTS2 模型加载和音频生成日志都会显示在该窗口；按 `Ctrl+C` 可停止服务。

## 聊天模型配置

应用通过 LangChain 的 `ChatOpenAI` 统一调用 OpenAI 兼容接口。要换成 DeepSeek、硅基流动或本地 vLLM，只需直接修改 `config.txt` 的 `[chat]` 段：

```ini
base_url = https://your-api.example/v1
model = your-model-name
api_key = your-api-key
```

## LM Studio

LM Studio 已兼容。当前 `config.txt` 中的服务已验证可访问，且可保持：

```ini
provider = lm_studio
api_key =
base_url = http://127.0.0.1:1234/v1
model = your-local-model-name
```

LM Studio 不验证 API 密钥时，程序会自动给 LangChain 使用内部占位值，不会把密钥发送到其他地方。切换回 DeepSeek 或其他服务时，设为 `provider = openai_compatible` 并填写真实 `api_key`。

`base_url` 必须是 API 根路径，通常需包含 `/v1`，例如 `https://api.deepseek.com/v1`。`config.txt` 同时集中维护 IndexTTS2 项目目录、默认音色和本地端口；改完后重启程序生效。依赖清单在 `requirements.txt`，当前已经安装到 IndexTTS2 自带的 `build_venv`。

## 技术说明

- IndexTTS2 首次合成会加载约 4.6GB 模型，RTX 5090  可正常承载；首次响应会明显较慢。
- 当前一次只进行一个语音合成任务，以避免多个请求同时抢占模型和显存。
- 生成音频保存于 `runtime/audio/`，可按需手工清理。
