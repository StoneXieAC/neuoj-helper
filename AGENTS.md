# Repository Guidelines

## 项目结构

`extension/` 是可直接加载到 Chrome 的 Manifest V3 扩展。`extension/src/core.js` 负责页面识别、信息提取和提示词组装；`content.js` 负责页面交互；`background.js` 负责接口请求；`options.html`、`options.js` 和 `options.css` 组成设置页。系统提示词位于 `extension/prompts/system.md`，随扩展分发的第三方脚本位于 `extension/vendor/`。`test/` 按对应模块存放测试。`html/` 是本地页面参考资料，已被 Git 忽略，不应作为运行时依赖。

## 开发与验证

- `npm ci`：按锁文件安装依赖。
- `npm test`：运行 Node.js 内置测试运行器中的全部测试。
- 在 `chrome://extensions/` 开启开发者模式，选择“加载已解压的扩展程序”并指定 `extension/`；修改扩展文件后在该页面重新加载。

项目没有构建或格式化脚本，`extension/` 中的文件就是交付内容。提交前至少运行 `npm test`；涉及页面交互时，还应在直连和 WebVPN 提交页手动核对。

## 代码风格与命名

沿用现有 JavaScript 风格：两个空格缩进、单引号、语句末尾加分号。变量和函数使用 `camelCase`，常量使用 `UPPER_SNAKE_CASE`；测试文件采用 `test/<模块名>.test.js`。扩展脚本使用现有普通脚本加载方式，修改共享逻辑时优先放入 `core.js`，保持可由 Node.js 测试导入。当前未配置 ESLint 或 Prettier，请避免无关的批量格式调整。

## 测试要求

测试使用 `node:test`、`node:assert/strict` 和 `jsdom`。新增解析规则、状态筛选、设置校验或请求处理时，在对应测试文件加入成功与失败场景；尤其覆盖直连及 WebVPN 地址、缺失页面元素和无效输入。项目未设覆盖率门槛。

## 配置与安全

不要提交 `.env`、API Key 或真实用户的提交内容。密钥由设置页保存到 Chrome 扩展本机存储；修改权限或请求目标时，同步检查 `extension/manifest.json` 中的授权范围，并保持仅在用户主动点击分析后发送题面、源码和评测信息。
