# Repository Guidelines

## 项目结构

`extension/` 是可直接加载到 Chrome 的 Manifest V3 扩展。`extension/src/core.js` 负责页面识别、信息提取和提示词组装；`content.js` 负责页面交互；`background.js` 负责接口请求；`options.html`、`options.js` 和 `options.css` 组成设置页。系统提示词位于 `extension/prompts/system.md`，随扩展分发的第三方脚本位于 `extension/vendor/`。`test/` 按对应模块存放测试。构建产物位于 `dist/chrome` 和 `dist/firefox`，不提交到 Git。

## 开发与验证

- `npm ci`：按锁文件安装依赖。
- `npm test`：运行 Node.js 内置测试运行器中的全部测试。
- 在 `chrome://extensions/` 开启开发者模式，选择“加载已解压的扩展程序”并指定 `dist/chrome/`；修改扩展文件后在该页面重新加载。

本地与 Actions 共用 `scripts/build.js`；`npm run dev:chrome` 和 `npm run dev:firefox` 分别构建单个浏览器，`npm run build` 构建两个版本。项目没有格式化脚本。提交前至少运行 `npm test`；涉及页面交互时，还应在 `https://oj.neu.edu.cn` 的提交页手动核对。

## 提交信息

沿用现有的 `类型: 中文描述` 格式，例如 `feat: 支持公式渲染`、`fix: 修复缓存丢失`。新增功能使用 `feat`，修复问题使用 `fix`；其他类型也保持相同格式。冒号后的中文描述不超过 10 个字，类型前缀、冒号和空格不计入长度。

## 代码风格与命名

沿用现有 JavaScript 风格：两个空格缩进、单引号、语句末尾加分号。变量和函数使用 `camelCase`，常量使用 `UPPER_SNAKE_CASE`；测试文件采用 `test/<模块名>.test.js`。扩展脚本使用现有普通脚本加载方式，修改共享逻辑时优先放入 `core.js`，保持可由 Node.js 测试导入。当前未配置 ESLint 或 Prettier，请避免无关的批量格式调整。

## 测试要求

测试使用 `node:test`、`node:assert/strict` 和 `jsdom`。新增解析规则、状态筛选、设置校验或请求处理时，在对应测试文件加入成功与失败场景；通用测试样例默认使用 `https://oj.neu.edu.cn`，尤其覆盖缺失页面元素和无效输入。项目未设覆盖率门槛。

## 配置与安全

不要提交 `.env`、API Key 或真实用户的提交内容。密钥由设置页保存到 Chrome 扩展本机存储；修改权限或请求目标时，同步检查 `extension/manifest.json` 中的授权范围，并保持仅在用户主动点击分析后发送题面、源码和评测信息。

## WebVPN 兼容

项目以 `https://oj.neu.edu.cn` 为默认访问入口。WebVPN 是额外兼容的访问方式；通用说明、界面文案和测试标题按 NEUOJ 功能描述，仅在 URL 解析和兼容场景中区分访问方式。

东北大学[官方服务说明](https://xwb.neu.edu.cn/10050/list.htm)将 WebVPN 定位为供师生从互联网端访问校内资源和图书馆数据库的方式。[使用指南](https://xwb.neu.edu.cn/10183/listm.htm)介绍了入口及统一身份认证流程，未公开下述 NEUOJ 代理标识的生成规则。以下 URL 与解析规则来自本地页面样例和现有实现，不应视为任意资源的通用代理规则。

NEUOJ 的完整代理 URL 结构为：

```text
https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/<NEUOJ路径>
```

例如，考试提交页和对应题目页为：

```text
https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/exam/46/submissions/1699672
https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/exam/46/problem/F
```

- 提交识别要求 HTTPS、允许的域名且 URL 不含用户名和密码。代理地址必须具有完整固定前缀 `/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/`；去掉代理前缀后按 NEUOJ 提交路径解析。当前实现不接受其他代理标识或缺失代理前缀的地址。页面识别还需检查源码、编译信息和评测区域。
- 题目地址从“返回题目”链接解析，必须与提交页同源、同所属范围及同代理前缀。题号匹配 `[A-Za-z0-9]+`；提交ID和训练、分组、比赛、考试ID仍按数字匹配。链接保留查询参数并清除片段。
- 代理题面中的 `https://oj.neu.edu.cn` 图片地址转换为当前代理地址；同源且没有代理前缀的站点根路径补上固定前缀。相对路径按题目地址解析，其他代理前缀下的同源图片会被拒绝。
- 代理缓存键为 `webvpn:<NEUOJ路径>`，其中路径保留开头的 `/`、去掉尾斜杠，不包含查询参数和片段。读取时兼容旧版完整代理 URL 缓存键，但旧地址仍需通过当前 URL 校验。常规访问使用 `https://oj.neu.edu.cn<NEUOJ路径>` 作为键，两种访问方式的缓存相互隔离。
- 涉及 URL、图片地址或缓存兼容的修改，自动测试与页面验收均需覆盖常规访问及代理访问。代理专项测试显式传入代理地址，保留成功与失败场景；不要通过删除这些测试来精简说明。
