# Vue 3 前端

独立的 Vue 3 + Vite 前端，复用上级目录 Python 服务的 `/api` 接口；不会替换现有 `static/` 页面。

双击 `start.bat`，或在 PowerShell 运行 `./start.ps1`。它会先启动后端，再启动 Vue，并在服务就绪后自动打开 `http://127.0.0.1:5173`。

Vue 专用配置位于 `runtime/config.txt`，从上级项目的 `config.txt` 复制而来；请只修改这一份。该文件被 Git 忽略，并且 Vite 明确禁止通过网页访问它，避免泄露 API Key。

也可以手动运行：

```powershell
cd {你的路径}\ai-voice-chat\vue
npm install
npm run dev
```

手动启动时，需要另行启动 FastAPI；建议直接使用 `./start.ps1`。

开发服务器已代理 `/api`、`/media`、`/generated-images` 和 `/live2dmodels`。手机宽度下界面自动切换为单栏，并隐藏 Live2D 面板。
