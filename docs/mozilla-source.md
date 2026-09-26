# Mozilla 审核源码说明

本项目使用普通 JavaScript，不转换或压缩自身源码。Node.js 22 或更新版本下运行 `npm ci` 和 `npm run build`；Firefox 输出在 `dist/firefox`。构建仅复制资源并转换清单，不改动浏览器运行时代码。

第三方资源来自 npm 的以下固定版本，许可证随 `extension/vendor` 分发。签名时的源码 ZIP 同时包含项目源码、锁文件和解包后的第三方可读源码：

- `markdown-it@15.0.2`：`dist/browser/markdown-it.umd.min.js`，移除末尾 source map 注释后保存为 `extension/vendor/markdown-it.umd.min.js`。
- `markdown-it-texmath@1.0.0`：`texmath.js`、`css/texmath.css`；仓库副本统一换行并清除行尾空格，没有功能修改。
- `mathjax@4.1.3`：`tex-svg.js` 和 `ui/safe.js`，原样复制。对应可读源码为 `@mathjax/src@4.1.3`；上游构建说明位于该包及 https://github.com/mathjax/MathJax-src 。
- `@mathjax/mathjax-newcm-font@4.1.3`：`svg/dynamic`，原样复制；源码包同时提供字体数据来源。

扩展不采集遥测。用户主动分析时，把题面、源码及评测信息发送给用户配置的模型 API；连接测试及分析通过用户填写的 API Key 认证。Firefox 清单声明网页内容和认证信息传输。没有自动发送提交内容的后台任务。
