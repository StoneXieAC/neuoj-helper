# 项目指引

本项目为 NEUOJ 提供浏览器扩展和 CLion 插件。浏览器扩展在用户点击后读取提交、题面和评测信息，请求用户配置的模型接口分析错误；CLion 插件支持导入题目、运行本地样例和提交代码。默认 OJ 入口是 `https://oj.neu.edu.cn`，还需兼容 WebVPN 入口 `https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/`。

# 代码位置

- `extension/`：浏览器扩展源码。`src/core.js` 负责页面识别、内容提取和提示词组装，`src/content.js` 负责提交页交互，`src/background.js` 负责请求与缓存，`src/options.*` 负责设置页，`src/ide-content.js` 负责题目导入与网页提交。清单、系统提示词和随扩展分发的脚本也在此目录。
- `clion-plugin/`：CLion 插件、本机连接、样例运行和正式提交功能。
- `scripts/`：浏览器构建与发行脚本；`test/`：按模块组织的扩展测试；`docs/`：IDE 协议与 Mozilla 审核资料。浏览器构建产物位于 `dist/chrome/` 和 `dist/firefox/`。

# 开发流程

- 先确认改动涉及扩展、CLion 插件还是两者，阅读对应源码与测试；新增行为补充必要的成功和失败用例。
- 扩展使用 Node.js 22 或更新版本；首次执行 `npm ci`。运行 `npm test` 验证；`npm run dev:chrome`、`npm run dev:firefox` 分别构建，`npm run build` 构建双端。
- CLion 插件使用 JDK 21；在 `clion-plugin/` 执行 `./gradlew test buildPlugin`，Windows 使用 `gradlew.bat test buildPlugin`。
- 提交前检查 `git status --short`、`git diff --check`、权限与敏感信息。仅在发布任务中同步版本；发布工作流负责构建、Firefox 检查、签名和发行。

# 开发规范

- 不得提交密钥或真实用户提交内容。只有用户主动点击分析后，才可发送题面、源码和评测信息。
- 除非用户明确允许或要求，不使用 Browser / Computer Use 验证 CLion、Web 或 VS Code 插件；优先通过代码检查、构建和必要的自动化测试验证。
