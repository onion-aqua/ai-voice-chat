# AI 语音聊天

这是一个本地网页聊天应用，需要 IndexTTS2 模型和预设音色。

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

## API 画图

点击输入框旁的“画图”即可切换模式。画图模式下发送的文字会提交到 OpenAI 兼容的 `POST /images/generations` 接口，生成结果直接显示在对话中，不进入 TTS 队列。

画图不会再复用聊天模型。默认 `model = auto` 会从当前 API 的 `/models` 中识别并选择可用的最新图片模型；如果服务商没有开放模型列表，请在 `[image]` 中填写专用图片模型。聊天接口和图片接口可以共用 `base_url`、API Key，但模型必须独立。若某个兼容服务把图片生成实现为 Responses API 的 `image_generation` 工具，程序会在检测到对应协议错误后自动切换。

```ini
[image]
api_key = your-image-api-key
base_url = https://your-image-api.example/v1
model = auto
size = 1024x1024
```

未填写 `image.api_key` 时，程序会复用 `[chat]` 的 `api_key`。OpenAI 可填写 `gpt-image-1.5`；Gemini 的 OpenAI 兼容接口可填写 `gemini-3.1-flash-image`。其他兼容服务请以其 `/models` 返回的图片模型为准；不要填写 `gpt-5.6`、Qwen 聊天模型等文字模型。

也可以在网页左侧的“模型设置”卡片中填写图片模型、图片 Base URL 和图片 API Key。默认仍优先使用 `config.txt`；点击“强制使用网页配置”后，聊天和画图都会改用本页填写的配置。

## 自动工具调用

聊天模型支持 OpenAI 风格的 function calling / tool calling 时，普通聊天中会自行决定是否调用联网搜索或图片生成工具：需要最新资料时搜索；用户明确要求创作图片时画图。工具结果会显示在对话区，并自动回传给模型继续组织最终回答和语音。

## 智能体模式

输入框旁的“智能体”默认开启。开启后，模型会自主规划并循环调用工具，页面会在回复中显示可折叠的执行记录；单轮最多执行 10 个工具步骤、10 次联网搜索和 10 次画图。关闭后回到普通聊天，但“联网”和“画图”手动按钮仍然可用。

输入框旁的“联网”和“画图”按钮仍可用，分别用于手动强制搜索或直接画图；不开启时由模型自主决定。

## 技术说明

- IndexTTS2 首次合成会加载约 4.6GB 模型，RTX 5090  可正常承载；首次响应会明显较慢。
- 当前一次只进行一个语音合成任务，以避免多个请求同时抢占模型和显存。
- 生成音频保存于 `runtime/audio/`，程序会自动只保留最新 10 个 `.wav` 文件。
- 使用 `start.bat` 启动时，HTTP 请求、模型与工具调用、TTS、图片接口和异常堆栈都会直接打印在 CMD 中；不会打印 API Key 或对话正文。

## Live2D 朗读演示

桌面端右侧提供一个 Live2D 演示角色。角色会在 IndexTTS2 的实际音频开始播放时读取该段的 8 维情绪向量，切换对应表情并以口型动画跟随朗读；暂停、结束或停止播放后会回到待机。

模型本体从项目根目录的 `live2dmodels/` 自动读取：每套模型应保留 `.model3.json`、`.moc3`、贴图和物理文件的相对目录结构。页面会自动选用找到的第一套模型；目前也会自动登记该模型目录下的 `expressions/*.exp3.json` 与 `motions/*.motion3.json`，使情感向量能驱动本地表情。PixiJS 和 Cubism 运行库仍通过 CDN 加载，因此首次打开仍需能访问该运行库；其加载失败不会影响聊天或 TTS。
