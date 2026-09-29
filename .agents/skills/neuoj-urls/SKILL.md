---
name: neuoj-urls
description: 修改或评审 neuoj-helper 对 NEUOJ 题目页、提交页、Contest、Training、Exam、Group、WebVPN、题图、缓存键及网页提交表单的 URL 解析和兼容行为时使用；不规定通用开发与发布流程。
---

# NEUOJ URL 与 Web 兼容

## 入口与边界

- 默认入口为 `https://oj.neu.edu.cn`；WebVPN 是额外兼容入口。通用说明、界面文案和普通测试标题按 NEUOJ 功能描述，只在解析与兼容场景区分访问方式。
- 当前 NEUOJ 代理入口固定为 `https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/`。该标识来自本地页面样例和现有实现，不是任意校内资源的通用代理规则。东北大学的[官方服务说明](https://xwb.neu.edu.cn/10050/list.htm)与[使用指南](https://xwb.neu.edu.cn/10183/listm.htm)只说明 WebVPN 用途和登录流程，未公开此代理标识的生成规则。
- URL 校验要求 HTTPS、允许域名、无用户名及密码。WebVPN 地址必须带完整固定前缀；不接受其他代理标识或无前缀的同源地址。涉及网页提交或 IDE 导入时，还需遵守对应函数对端口和路径的更严格限制，勿以较宽的提交页识别规则替代。

## 页面路径

下表中的路径均相对于常规入口或去掉 WebVPN 固定前缀之后；`<ID>` 为数字，`<题号>` 为字母数字。

| 场景 | 题目页 | 提交详情页 |
| --- | --- | --- |
| 普通题目 | `/problems/<题号>` | `/submission/<ID>` 或 `/submissions/<ID>` |
| Training | `/training/<ID>/part/<ID>/problem/<题号>` | `/training/<ID>/submission/<ID>` 或复数形式 |
| Group | `/group/<ID>/problem/<题号>` 或 `/group/<ID>/problems/<题号>` | 同所属范围内的提交路径，以实际页面链接为准 |
| Contest | `/contest/<ID>/problem/<题号>` | `/contest/<ID>/submission/<ID>` 或复数形式 |
| Exam | `/exam/<ID>/problem/<题号>` | `/exam/<ID>/submission/<ID>` 或复数形式 |

- 提交页分析的 URL 识别以 `extension/src/core.js` 的 `submissionPath()` 和页面结构检查为准：提交地址以 `submission[s]/<数字>` 结尾，页面还需存在源码、编译信息与评测区域。不要把上表当成所有提交路径的穷举清单；当前解析还接受其他范围下匹配提交后缀的路径。
- 题目链接从页面中的“返回题目”取得，必须与提交页同源、同所属范围、同代理前缀；保留查询参数，清除片段。题号允许 `[A-Za-z0-9]+`，范围 ID 与提交 ID 仍为数字。不要凭提交 ID 猜题目地址。
- WebVPN 提交页的“返回题目”链接若指向未带代理前缀的站点根路径，当前分析解析会拒绝它；不要将题图或提交表单的前缀修正规则误套到该链接。Group 题目页的 `problem` 与 `problems` 两种路径可供 IDE 导入识别，但当前分析页的兜底“返回题目”匹配只接受 `problem`。
- IDE 导入的题目路径比提交页识别更窄，以 `core.problemIdentity()`、后台 `ideSource()` 和 `docs/ide-protocol.md` 为准。网页正式提交还需校验实际表单 `action` 与当前题目相符；站点可能给出根路径或直连地址，WebVPN 页面须按当前固定前缀解析，不能转到另一入口、题目或代理标识。站点只跳转记录页、跳转登录页或未返回提交详情时，不应报告已确认成功或自动重投源码。

## 资源与缓存

- WebVPN 题面中的直连 `https://oj.neu.edu.cn` 图片地址需转换为当前代理地址；同源且缺少代理前缀的站点根路径需补前缀；相对路径按题目地址解析。拒绝同源但属于其他代理前缀的图片，不要向其发起请求。题面图片提取以 `core.problemImageUrl()` 和内容脚本为准。
- 普通访问的缓存键是 `https://oj.neu.edu.cn<NEUOJ路径>`；代理访问的缓存键是 `webvpn:<NEUOJ路径>`。路径保留开头 `/`、去掉尾斜杠，不含查询参数和片段；两种访问方式相互隔离。读取时兼容旧版完整代理 URL 键，但旧地址仍需通过当前 URL 校验。

## 修改与验证

- 改动 URL、题面图片或缓存兼容行为时，同时检查常规和代理入口，并在自动测试中覆盖成功与失败场景。代理专项测试要显式传入代理地址；不要删除已有代理测试来精简说明。主要测试位于 `test/core.test.js`、`test/content.test.js`、`test/background.test.js`、`test/ide.test.js` 和 `test/cache-integration.test.js`。
- 当前规则应与实现和测试相互核对；遇到新的站点路径或 WebVPN 页面差异，先基于实际页面样例确认，再更新解析、测试与本 Skill。验证工具、提交规范和发布流程见 `neuoj-development` SKILL。
