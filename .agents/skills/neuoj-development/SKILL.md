---
name: neuoj-development
description: 在 neuoj-helper 仓库中开发、测试、安装、记录版本、提交或发布浏览器扩展与 CLion 插件时使用；不负责 NEUOJ 专有 URL 与 WebVPN 规则。
---

# NEUOJ 项目开发

## 适用范围与入口

- 浏览器扩展源码在 `extension/`，`scripts/build.js` 生成 `dist/chrome/` 和 `dist/firefox/`；这些产物不提交到 Git。`extension/src/core.js` 放可供 Node.js 测试的共享逻辑，`content.js` 负责页面交互，`background.js` 负责接口请求，`options.*` 负责设置页。普通脚本由清单按顺序加载，不要无故改为模块化或批量调整格式。
- CLion 插件在 `clion-plugin/`。涉及本机协议时查看 `docs/ide-protocol.md`；涉及插件构建、原生计时程序或安装时查看 `clion-plugin/README.md`。
- 处理地址、页面路径、WebVPN、图片地址或缓存键时，另读 `neuoj-urls` SKILL。此 Skill 只规定开发流程，不定义站点 URL 规则。

## 开发与安装

- 浏览器扩展要求 Node.js 22 或更新版本。按锁文件安装依赖用 `npm ci`；`npm run dev:chrome`、`npm run dev:firefox` 分别构建一个浏览器，`npm run build` 构建两个浏览器。清单从 `extension/manifest.json` 构建；Firefox 版本由构建脚本转换后台清单。
- 本地调试 Chrome：构建后在 `chrome://extensions/` 加载 `dist/chrome/`，修改后重建并重新加载扩展。发行版安装步骤以根目录 `README.md` 为准。
- CLion 插件使用 JDK 21；在 `clion-plugin/` 运行 `./gradlew test buildPlugin`，Windows 使用 `gradlew.bat`。其他本地构建参数、原生辅助程序的更新步骤以该目录的 `README.md` 为准。

## 代码与提交

- JavaScript 沿用两个空格缩进、单引号、语句末尾分号；变量和函数使用 `camelCase`，常量使用 `UPPER_SNAKE_CASE`。测试文件置于 `test/<模块名>.test.js`，使用 `node:test`、`node:assert/strict` 和 `jsdom`。不为无关代码做批量格式调整。
- Commit 信息采用 `类型: 中文描述`，新增功能用 `feat`，修复问题用 `fix`；冒号后的中文描述不超过 10 个字。提交前查看差异，避免加入构建产物、`.env`、API Key 或真实用户的提交内容。
- 修改权限或请求目标时核对 `extension/manifest.json`；题面、源码和评测信息只能在用户主动点击分析后发送到其配置的接口。密钥保存在扩展本机存储中。

## 测试与验证

- 提交前至少运行 `npm test`。按改动范围选择构建或 CLion 测试；发布前执行两个浏览器构建并参考 `.github/workflows/release.yml` 中的检查。新增解析、状态筛选、设置校验或请求处理时，在对应测试中覆盖成功和失败情况，特别注意缺失页面元素与无效输入。
- 除非用户明确允许或要求，不使用 Browser / Computer Use 验证 CLion、Web 或 VS Code 插件；优先通过代码检查、构建和必要的自动化测试验证。页面交互优先用自动化测试；需要访问实际 NEUOJ 提交页核对时，也须先取得用户明确允许。测试以本次修改的风险为限，避免过多或重复验证。
- 涉及 URL、图片或缓存兼容时，按 URL Skill 同时覆盖常规访问和 WebVPN 访问；不要删减已有代理专项成功、失败用例来使测试通过。

## 版本与发布

- 版本记录以 `package.json`、`package-lock.json`、`extension/manifest.json` 的 `version_name` 和 `clion-plugin/build.gradle.kts` 为一组；扩展清单的数字 `version` 与预发布后缀分开记录。准备版本标签时同步核对，`.github/workflows/release.yml` 会检查标签与这些字段一致。
- `.github/workflows/release.yml` 在标签触发时测试、构建、打包 Chrome、经 Mozilla 签名并核验 Firefox XPI，随后发布 GitHub Release。发布任务先核对工作流和 `scripts/release.js`；签名凭据由 CI Secret 提供，不写入仓库。Mozilla 审核源码说明见 `docs/mozilla-source.md`。
- 不因修改文档或普通功能就自行更新版本、创建标签或发布；按任务要求和现有发布流程执行这些操作。
