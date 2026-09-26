# NEUOJ 小助手

## 使用

1. 从 [GitHub Releases](https://github.com/StoneXieAC/neuoj-helper/releases/latest) 下载适合浏览器的压缩包，解压后安装插件。Chrome 114、Edge 114 或更新版本使用 `neuoj-helper-<版本号>-chromium.zip`；Firefox 128 或更新版本使用 `neuoj-helper-<版本号>-firefox.zip`。
   - Chrome：打开 `chrome://extensions/`，启用开发者模式，选择“加载已解压的扩展程序”，选中解压后的目录。
   - Edge：打开 `edge://extensions/`，启用开发人员模式，选择“加载解压缩的扩展”，选中解压后的目录。
   - Firefox：打开 `about:debugging#/runtime/this-firefox`，选择“临时载入附加组件”，选中解压后目录中的 `manifest.json`。未签名的临时扩展会在 Firefox 关闭后卸载，重启后需要再次载入。
2. 点击工具栏中的插件图标，或提交页分析面板右侧的设置图标。打开“API 设置”，填写 API Base URL、API Key 和模型，点击“确认”保存。首次保存时，浏览器会请求接口域名权限。
3. 打开 [NEUOJ](https://oj.neu.edu.cn) 的提交详情页。提交评测完成并显示错误结果时，点击“分析错误”查看回答。

支持通过东北大学 WebVPN 访问 NEUOJ。

设置页提供“测试连接”，可以在保存前检查当前填写的接口信息。默认接口为 `https://api.deepseek.com`，默认模型为 `deepseek-flash`。Base URL 可以包含 `/v1`，插件会拼接 `/chat/completions`；接口支持 HTTPS，以及 `localhost` 或 `127.0.0.1` 上的 HTTP 服务。API Key 只保存在浏览器的本机扩展存储中。

思考等级可留空。留空并保存后，请求不会包含 `reasoning_effort`，适用于不支持该参数的接口。“提示词设置”可以修改内置系统提示词，也可以点击“恢复默认”还原编辑框内容；两种操作都需要点击“确认”保存。

分析结果保存在本机。返回或刷新同一提交页时会恢复上次的回答，点击“重新分析”可以更新结果；只保留最近 10 个提交的结果。若缓存保存失败，页面仍显示当次回答，但刷新后可能无法恢复。分析面板右侧的复制图标可以复制回答的 Markdown 原文，包括生成中的内容和已恢复的缓存回答；没有回答时不可点击。

## 工作方式

插件通过域名、提交页路径和页面结构识别 NEUOJ 提交页。点击“分析错误”后，它从同源题目页读取题面，从提交页读取源码、编译错误和有关评测信息。题面无法获取或正文缺失时，页面会提示重试，不发送分析请求。AC 提交不会发起分析。

WA 分析会保留页面提供的标准答案和用户输出；RE、TLE、MLE 等会保留错误详情及有关退出状态。提示词总长限制为 24,000 字符，过长内容会标记 `[内容过长，已截断]`。题面、源码和评测信息只有在用户点击分析按钮后才会发送给已配置的接口服务。

回答会流式显示，并渲染 Markdown 和 LaTeX 公式。渲染所需脚本和字体随插件提供；回答中的原始 HTML、图片和不安全链接不会执行或加载。若接口明确不支持流式请求，插件会自动重试一次非流式请求。

## 开发

`extension/` 是可直接加载的 Chrome、Edge 扩展源码；Firefox 版本由 `scripts/build-firefox.js` 转换清单后生成。共享解析逻辑位于 `extension/src/core.js`，页面交互、请求处理和设置页分别位于 `content.js`、`background.js` 和 `options.*`。内置系统提示词位于 `extension/prompts/system.md`，第三方脚本位于 `extension/vendor/`。

在仓库根目录运行 `npm ci` 和 `npm test`。推送到 `main` 后，GitHub Actions 会测试并验证 Chrome／Edge 与 Firefox 发行包；推送与 `extension/manifest.json` 版本一致的 `v<版本号>` 标签后，工作流会将两份 ZIP 发布到 GitHub Releases。需要本地核对发行包时，可运行 `npm run build:releases`，输出位于已被 Git 忽略的 `dist/releases/`。

涉及页面交互的修改还需在 Chrome 和 Firefox 中分别检查 NEUOJ 提交页，包括设置入口、接口域名授权、连接测试、分析结果及刷新后的缓存恢复。页面验收需在能访问 NEUOJ 的网络环境中进行。
