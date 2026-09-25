const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const markdownit = require('markdown-it');
const core = require('../extension/src/core.js');

const script = fs.readFileSync(path.join(__dirname, '../extension/src/content.js'), 'utf8');
const url = 'https://webvpn.neu.edu.cn/https/opaque-id/training/8/submission/123';
const problemUrl = 'https://webvpn.neu.edu.cn/https/opaque-id/training/8/part/68/problem/286';
const generalUrl = 'https://webvpn.neu.edu.cn/https/opaque-id/submissions/123';
const generalProblemUrl = 'https://webvpn.neu.edu.cn/https/opaque-id/problems/43';
const directGeneralUrl = 'https://oj.neu.edu.cn/submissions/123';
const directGeneralProblemUrl = 'https://oj.neu.edu.cn/problems/43';
const problemHtml = '<div class="col-7"><div class="card mb-2"><div class="card-header"><a class="nav-link"><strong>求幂</strong></a></div></div><div id="problem-content-vditor"><p>计算 <span data-math="m^n">公式</span>。</p></div><div id="example-input">5 8</div><div id="example-output">390625</div></div>';
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(status, optionsResponse = { ok: true }, fetchProblem = async () => ({ ok: true, url: problemUrl, text: async () => problemHtml }), pageUrl = url, linkedProblem = problemUrl) {
  const dom = new JSDOM(`<!doctype html><html><body><a href="${linkedProblem}">返回题目</a><div id="tabs-source-code"><button data-clipboard-text="int main(){}"></button></div>
    <div id="tabs-compile-info"><div class="card-header">编译成功</div></div>
    <div class="tab-content"><div id="tabs-testcase-judging"><div class="card"><div class="card-body"><div>#001 ${status}</div>
    <div id="show_output_system0"><div class="modal-body">exitcode: 0</div></div>
    <div id="show_output_diff0"><div class="modal-body">Judge: 1<br>Team: 2</div></div>
    <div id="show_output_error0"><div class="modal-body"></div></div></div></div></div></div></body></html>`, { url: pageUrl });
  let sent;
  let fetchCount = 0;
  let receive;
  let disconnected;
  const port = {
    onMessage: { addListener(fn) { receive = fn; } },
    onDisconnect: { addListener(fn) { disconnected = fn; } },
    postMessage(message) { sent = message; },
    disconnect() { disconnected?.(); }
  };
  const chrome = { runtime: {
    lastError: null,
    connect() { return port; },
    sendMessage(message, callback) { sent = message; callback(optionsResponse); }
  } };
  const context = { globalThis: { NEUOJCore: core, markdownit }, location: dom.window.location,
    document: dom.window.document, chrome, MutationObserver: dom.window.MutationObserver,
    DOMParser: dom.window.DOMParser, fetch: (...args) => { fetchCount++; return fetchProblem(...args); }, URL,
    setTimeout, setInterval, clearInterval,
    requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout };
  vm.runInNewContext(script, context);
  return {
    document: dom.window.document,
    get sent() { return sent; },
    get fetchCount() { return fetchCount; },
    emit(message) { receive(message); },
    disconnect() { disconnected(); }
  };
}

test('WA 点击后才发送提示词，收到首段即显示 Markdown，完成后恢复按钮', async () => {
  const app = setup('答案错误');
  const host = app.document.getElementById('neuoj-helper-root');
  assert.ok(host);
  const shadow = host.shadowRoot;
  assert.equal(app.sent, undefined);
  const status = shadow.querySelector('.status');
  assert.equal(status.hidden, true);
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.ok(shadow.querySelector('.top .actions').contains(status));
  assert.equal(shadow.querySelector('.hint'), null);
  const button = shadow.querySelector('button');
  button.click();
  assert.equal(app.fetchCount, 1);
  assert.equal(app.sent, undefined);
  await flush();
  assert.equal(app.sent.type, 'ANALYZE');
  assert.match(app.sent.prompt, /标准答案：1/);
  assert.match(app.sent.prompt, /题目：求幂/);
  assert.match(app.sent.prompt, /\$m\^n\$/);
  assert.equal(button.disabled, true);
  assert.equal(status.dataset.state, 'loading');
  assert.equal(status.textContent, '正在分析…');
  assert.equal(status.hidden, false);
  app.emit({ type: 'DELTA', text: '**可能**' });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(shadow.querySelector('.result strong').textContent, '可能');
  assert.equal(shadow.querySelector('.result').hidden, false);
  assert.equal(button.disabled, true);
  assert.equal(status.textContent, '正在分析…');
  app.emit({ type: 'DELTA', text: '在循环处' });
  app.emit({ type: 'DONE' });
  assert.equal(shadow.querySelector('.result').textContent.trim(), '可能在循环处');
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '重新分析');
  assert.equal(status.dataset.state, 'success');
  assert.equal(status.textContent, '分析完成');
});

test('失败状态直接显示具体原因，重试时清空旧结果并恢复加载状态', async () => {
  const app = setup('答案错误');
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  const button = shadow.querySelector('button');
  const status = shadow.querySelector('.status');
  button.click();
  await flush();
  app.emit({ type: 'DELTA', text: '旧结果' });
  app.emit({ type: 'ERROR', error: 'API Key 无效' });
  assert.equal(status.dataset.state, 'error');
  assert.equal(status.textContent, 'API Key 无效');
  assert.equal(button.disabled, false);
  assert.equal(shadow.querySelector('.result').textContent.trim(), '旧结果');
  button.click();
  await flush();
  assert.equal(status.dataset.state, 'loading');
  assert.equal(status.textContent, '正在分析…');
  assert.equal(shadow.querySelector('.result').hidden, true);
  app.emit({ type: 'DONE' });
});

test('原始 HTML、危险链接和图片不会进入分析结果 DOM', async () => {
  const app = setup('答案错误');
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  shadow.querySelector('button').click();
  await flush();
  app.emit({ type: 'DELTA', text: '<img src=x onerror=alert(1)> [危险](javascript:alert(1)) ![图片](https://example.com/a.png) [安全](https://example.com)' });
  app.emit({ type: 'DONE' });
  const result = shadow.querySelector('.result');
  assert.equal(result.querySelector('img'), null);
  assert.equal(result.querySelector('[onerror]'), null);
  assert.equal(result.querySelector('a[href^="javascript:"]'), null);
  assert.match(result.textContent, /<img src=x/);
  const safe = result.querySelector('a');
  assert.equal(safe.getAttribute('href'), 'https://example.com');
  assert.equal(safe.getAttribute('target'), '_blank');
  assert.equal(safe.getAttribute('rel'), 'noopener noreferrer');
});

test('流中断时保留已有结果并提示错误', async () => {
  const app = setup('答案错误');
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  shadow.querySelector('button').click();
  await flush();
  app.emit({ type: 'DELTA', text: '已生成部分' });
  app.disconnect();
  assert.equal(shadow.querySelector('.result').textContent.trim(), '已生成部分');
  assert.match(shadow.querySelector('.status').textContent, /连接已中断/);
  assert.equal(shadow.querySelector('.status').dataset.state, 'error');
  assert.equal(shadow.querySelector('button').disabled, false);
});

test('题面请求失败、跳转登录页或正文缺失时停止分析并可重试', async () => {
  for (const fetchProblem of [
    async () => { throw new Error('网络中断'); },
    async () => ({ ok: false, url: problemUrl }),
    async () => ({ ok: true, url: 'https://webvpn.neu.edu.cn/login', text: async () => problemHtml }),
    async () => ({ ok: true, url: problemUrl, text: async () => '<html><body>登录</body></html>' })
  ]) {
    const app = setup('答案错误', { ok: true }, fetchProblem);
    const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
    const button = shadow.querySelector('button');
    button.click();
    assert.equal(button.disabled, true);
    await flush();
    assert.equal(app.sent, undefined);
    assert.equal(button.disabled, false);
    assert.equal(shadow.querySelector('.status').dataset.state, 'error');
    assert.match(shadow.querySelector('.status').textContent, /无法获取题面/);
  }
});

test('题目链接缺失时不请求页面也不连接模型', () => {
  const app = setup('答案错误');
  app.document.querySelector('a').remove();
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  shadow.querySelector('button').click();
  assert.equal(app.fetchCount, 0);
  assert.equal(app.sent, undefined);
  assert.match(shadow.querySelector('.status').textContent, /无法定位对应题面/);
});

test('全 AC 不插入分析面板', () => {
  const app = setup('答案正确');
  assert.equal(app.document.getElementById('neuoj-helper-root'), null);
});

test('通用提交页仅在失败时显示面板并可读取题面发起分析', async () => {
  const fetchProblem = async requested => ({ ok: true, url: requested, text: async () => problemHtml });
  for (const [pageUrl, linkedProblem] of [[generalUrl, generalProblemUrl], [directGeneralUrl, directGeneralProblemUrl]]) {
    const app = setup('答案错误', { ok: true }, fetchProblem, pageUrl, linkedProblem);
    const host = app.document.getElementById('neuoj-helper-root');
    assert.ok(host);
    host.shadowRoot.querySelector('button').click();
    await flush();
    assert.equal(app.fetchCount, 1);
    assert.equal(app.sent.type, 'ANALYZE');
    assert.match(app.sent.prompt, /标准答案：1/);
    assert.match(app.sent.prompt, /题目：求幂/);
    app.emit({ type: 'DONE' });
    const accepted = setup('答案正确', { ok: true }, fetchProblem, pageUrl, linkedProblem);
    assert.equal(accepted.document.getElementById('neuoj-helper-root'), null);
  }
});

test('角落齿轮具有名称并向后台发送打开消息', () => {
  const app = setup('答案错误');
  const settings = app.document.getElementById('neuoj-helper-root').shadowRoot.querySelector('.settings');
  assert.equal(settings.getAttribute('aria-label'), '接口设置');
  assert.equal(settings.title, '接口设置');
  assert.ok(settings.querySelector('svg[aria-hidden="true"]'));
  settings.click();
  assert.deepEqual(JSON.parse(JSON.stringify(app.sent)), { type: 'OPEN_OPTIONS' });
});

test('设置弹窗打开失败时在操作栏显示红色具体原因', () => {
  const app = setup('答案错误', { ok: false, error: '窗口创建失败' });
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  shadow.querySelector('.settings').click();
  const status = shadow.querySelector('.status');
  assert.equal(status.dataset.state, 'error');
  assert.equal(status.textContent, '无法打开接口设置：窗口创建失败');
});

test('异步评测完成后分析按钮自动启用', async () => {
  const app = setup('评测中');
  const button = app.document.getElementById('neuoj-helper-root').shadowRoot.querySelector('button');
  const status = app.document.getElementById('neuoj-helper-root').shadowRoot.querySelector('.status');
  assert.equal(button.disabled, true);
  assert.equal(status.dataset.state, 'waiting');
  assert.equal(status.textContent, '等待评测');
  app.document.querySelector('#tabs-testcase-judging .card-body > div').textContent = '#001 答案错误';
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.disabled, false);
  assert.equal(status.hidden, true);
});

test('先出现 AC 测试点、后出现失败点时仍展示面板', async () => {
  const app = setup('答案正确');
  assert.equal(app.document.getElementById('neuoj-helper-root'), null);
  app.document.querySelector('#tabs-testcase-judging .card-body > div').textContent = '#001 答案错误';
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(app.document.getElementById('neuoj-helper-root'));
});
