const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const markdownit = require('markdown-it');
const katex = require('katex');
const texmath = require('markdown-it-texmath');
const core = require('../extension/src/core.js');

const script = fs.readFileSync(path.join(__dirname, '../extension/src/content.js'), 'utf8');
const url = 'https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/training/8/submission/123';
const problemUrl = 'https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/training/8/part/68/problem/286';
const generalUrl = 'https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/submissions/123';
const generalProblemUrl = 'https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/problems/43';
const directGeneralUrl = 'https://oj.neu.edu.cn/submissions/123';
const directGeneralProblemUrl = 'https://oj.neu.edu.cn/problems/43';
const contestUrl = 'https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/contest/162/submissions/1711165';
const contestProblemUrl = 'https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/contest/162/problem/10';
const problemHtml = '<div class="col-7"><div class="card mb-2"><div class="card-header"><a class="nav-link"><strong>求幂</strong></a></div></div><div id="problem-content-vditor"><p>计算 <span data-math="m^n">公式</span>。</p></div><div id="example-input">5 8</div><div id="example-output">390625</div></div>';
const contestProblemHtml = '<div class="col-7"><div class="card mb-2"><div class="card-header"><a class="nav-link"><strong>J - 状态转换</strong></a></div></div><div id="problem-content-vditor"><p>按规则转换状态。</p></div><div id="example-input">3</div><div id="example-output">7</div></div>';
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(status, optionsResponse = { ok: true }, fetchProblem = async () => ({ ok: true, url: problemUrl, text: async () => problemHtml }), pageUrl = url, linkedProblem = problemUrl, cachedAnswer = null, timers = null) {
  const dom = new JSDOM(`<!doctype html><html><body><a href="${linkedProblem}">返回题目</a><div id="tabs-source-code"><button data-clipboard-text="int main(){}"></button></div>
    <div id="tabs-compile-info"><div class="card-header">编译成功</div></div>
    <div class="tab-content"><div id="tabs-testcase-judging"><div class="card"><div class="card-body"><div>#001 ${status}</div>
    <div id="show_output_system0"><div class="modal-body">exitcode: 0</div></div>
    <div id="show_output_diff0"><div class="modal-body">Judge: 1<br>Team: 2</div></div>
    <div id="show_output_error0"><div class="modal-body"></div></div></div></div></div></div></body></html>`, { url: pageUrl });
  let sent;
  let fetchCount = 0;
  let cacheRequests = 0;
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
    getURL(file) { return `chrome-extension://neuoj-helper/${file}`; },
    connect() { return port; },
    sendMessage(message, callback) {
      if (message.type === 'GET_CACHED_RESULT') {
        cacheRequests++;
        if (typeof cachedAnswer === 'function') cachedAnswer(callback);
        else callback({ ok: true, answer: cachedAnswer });
        return;
      }
      sent = message;
      callback(optionsResponse);
    }
  } };
  const context = { globalThis: { NEUOJCore: core, markdownit, katex, texmath }, location: dom.window.location,
    document: dom.window.document, chrome, MutationObserver: dom.window.MutationObserver,
    DOMParser: dom.window.DOMParser, fetch: (...args) => { fetchCount++; return fetchProblem(...args); }, URL, btoa,
    setTimeout: timers?.setTimeout || setTimeout, clearTimeout: timers?.clearTimeout || clearTimeout,
    setInterval, clearInterval, AbortController,
    requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout };
  vm.runInNewContext(script, context);
  return {
    document: dom.window.document,
    get sent() { return sent; },
    get fetchCount() { return fetchCount; },
    get cacheRequests() { return cacheRequests; },
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
  assert.ok(status.querySelector('.status-icon[aria-hidden="true"]'));
  assert.equal(status.querySelector('.status-text').textContent, '分析完成');
});

test('图片题点击后按题面顺序读取图片，按真实格式发送数据', async () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const jpeg = Uint8Array.from([255, 216, 255, 1]);
  const imageUrls = [new URL('./a.jpeg', problemUrl).href, new URL('./b.jpg', problemUrl).href];
  const requested = [];
  const fetchProblem = async (target, options) => {
    requested.push([target, options]);
    if (target === problemUrl) return { ok: true, url: target, text: async () =>
      `<div id="problem-content-vditor"><p>先看<img src="./a.jpeg">再看<img src="./b.jpg"></p></div>` };
    const bytes = target === imageUrls[0] ? png : jpeg;
    return { ok: true, url: target, headers: { get: () => null }, body: new Response(bytes).body };
  };
  const app = setup('答案错误', { ok: true }, fetchProblem);
  assert.equal(app.fetchCount, 0);
  app.document.getElementById('neuoj-helper-root').shadowRoot.querySelector('button').click();
  await flush();
  await flush();
  assert.deepEqual(requested.map(item => item[0]), [problemUrl, ...imageUrls]);
  assert.equal(requested[1][1].credentials, 'same-origin');
  assert.match(app.sent.prompt, /先看 \[题图 1\] 再看 \[题图 2\]/);
  assert.deepEqual(Array.from(app.sent.images), [
    `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`
  ]);
  app.emit({ type: 'DONE' });
});

test('直连题面图片使用直连地址读取', async () => {
  const target = new URL('./diagram.png', directGeneralProblemUrl).href;
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const requested = [];
  const fetchProblem = async (requestedUrl, options) => {
    requested.push([requestedUrl, options]);
    return requestedUrl === directGeneralProblemUrl
      ? { ok: true, url: requestedUrl, text: async () => '<div id="problem-content-vditor"><img src="./diagram.png"></div>' }
      : { ok: true, url: requestedUrl, headers: { get: () => null }, body: new Response(png).body };
  };
  const app = setup('答案错误', { ok: true }, fetchProblem, directGeneralUrl, directGeneralProblemUrl);
  app.document.getElementById('neuoj-helper-root').shadowRoot.querySelector('button').click();
  await flush();
  await flush();
  assert.deepEqual(requested.map(item => item[0]), [directGeneralProblemUrl, target]);
  assert.equal(requested[1][1].credentials, 'same-origin');
  assert.match(app.sent.images[0], /^data:image\/png;base64,/);
  app.emit({ type: 'DONE' });
});

test('题图读取失败和超限时停止分析并提示错误', async () => {
  for (const [imageResponse, message] of [
    [{ ok: false, url: new URL('./bad.png', problemUrl).href }, /题图 1 下载失败/],
    [{ ok: true, url: new URL('./bad.png', problemUrl).href,
      headers: { get: () => String(6 * 1024 * 1024) } }, /题图 1 超过图片大小限制/]
  ]) {
    const fetchProblem = async target => target === problemUrl
      ? { ok: true, url: target, text: async () => '<div id="problem-content-vditor"><p><img src="./bad.png"></p></div>' }
      : imageResponse;
    const app = setup('答案错误', { ok: true }, fetchProblem);
    app.document.getElementById('neuoj-helper-root').shadowRoot.querySelector('button').click();
    await flush();
    assert.equal(app.sent, undefined);
    assert.match(app.document.getElementById('neuoj-helper-root').shadowRoot.querySelector('.status').textContent, message);
  }
});

test('无 Content-Length 的超大题图在读取中止并取消数据流', async () => {
  let canceled = false;
  let reads = 0;
  const body = new ReadableStream({
    pull(controller) {
      reads++;
      controller.enqueue(reads === 1 ? Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
        : new Uint8Array(5 * 1024 * 1024));
    },
    cancel() { canceled = true; }
  });
  const imageUrl = new URL('./large.png', problemUrl).href;
  const fetchProblem = async target => target === problemUrl
    ? { ok: true, url: target, text: async () => '<div id="problem-content-vditor"><img src="./large.png"></div>' }
    : { ok: true, url: imageUrl, headers: { get: () => null }, body };
  const app = setup('答案错误', { ok: true }, fetchProblem);
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  shadow.querySelector('button').click();
  await flush();
  await flush();
  assert.equal(canceled, true);
  assert.equal(app.sent, undefined);
  assert.match(shadow.querySelector('.status').textContent, /超过图片大小限制/);
});

test('WebVPN 其他代理前缀的题图不会被请求或发送', async () => {
  const fetchProblem = async target => ({ ok: true, url: target,
    text: async () => '<div id="problem-content-vditor"><img src="/https/other-token/private.png"></div>' });
  const app = setup('答案错误', { ok: true }, fetchProblem);
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  shadow.querySelector('button').click();
  await flush();
  assert.equal(app.fetchCount, 1);
  assert.equal(app.sent, undefined);
  assert.match(shadow.querySelector('.status').textContent, /题图 1 地址无效/);
});

test('题图下载超时会取消请求并允许重新分析', async () => {
  let expire;
  let imageSignal;
  const timers = {
    setTimeout(fn, delay) { if (delay === 30000) { expire = fn; return 123456; } return setTimeout(fn, delay); },
    clearTimeout(id) { if (id !== 123456) clearTimeout(id); }
  };
  const fetchProblem = async (target, options) => target === problemUrl
    ? { ok: true, url: target, text: async () => '<div id="problem-content-vditor"><img src="./a.png"></div>' }
    : (imageSignal = options.signal, new Promise(() => {}));
  const app = setup('答案错误', { ok: true }, fetchProblem, url, problemUrl, null, timers);
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  const button = shadow.querySelector('button');
  button.click();
  await flush();
  assert.ok(imageSignal);
  expire();
  await flush();
  assert.equal(imageSignal.aborted, true);
  assert.equal(app.sent, undefined);
  assert.equal(button.disabled, false);
  assert.match(shadow.querySelector('.status').textContent, /超时/);
});

test('Contest 复数提交页点击后获取同比赛题面并发送分析', async () => {
  let requestedUrl;
  const fetchProblem = async url => {
    requestedUrl = url;
    return { ok: true, url, text: async () => contestProblemHtml };
  };
  const app = setup('答案错误', { ok: true }, fetchProblem, contestUrl, contestProblemUrl);
  const button = app.document.getElementById('neuoj-helper-root').shadowRoot.querySelector('button');
  assert.equal(button.disabled, false);
  assert.equal(app.fetchCount, 0);
  button.click();
  await flush();
  assert.equal(requestedUrl, contestProblemUrl);
  assert.equal(app.sent.type, 'ANALYZE');
  assert.match(app.sent.prompt, /题目：J - 状态转换/);
  assert.match(app.sent.prompt, /按规则转换状态/);
  assert.match(app.sent.prompt, /输入样例：[\s\S]*3/);
  app.emit({ type: 'DONE' });
});

test('再次进入同一提交时直接恢复缓存，重新分析仍由用户点击触发', async () => {
  const app = setup('答案错误', { ok: true }, undefined, url, problemUrl, '**缓存结论**');
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  assert.equal(shadow.querySelector('.result strong').textContent, '缓存结论');
  assert.equal(shadow.querySelector('.status').textContent, '已恢复上次分析');
  assert.equal(shadow.querySelector('button').textContent, '重新分析');
  assert.equal(app.fetchCount, 0);
  assert.equal(app.sent, undefined);
  assert.equal(app.document.defaultView.location.href, url);
  shadow.querySelector('button').click();
  assert.equal(shadow.querySelector('.result').hidden, true);
  await flush();
  assert.equal(app.sent.type, 'ANALYZE');
  assert.equal(app.document.defaultView.location.href, url);
  app.emit({ type: 'DONE' });
});

test('刷新时先显示评测中，结果转为失败后恢复缓存且不请求模型', async () => {
  const app = setup('评测中', { ok: true }, undefined, url, problemUrl, '**缓存结论**');
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  assert.equal(app.cacheRequests, 0);
  app.document.querySelector('#tabs-testcase-judging .card-body > div').textContent = '#001 答案错误';
  await flush();
  assert.equal(app.cacheRequests, 1);
  assert.equal(shadow.querySelector('.result strong').textContent, '缓存结论');
  assert.equal(shadow.querySelector('.status').textContent, '已恢复上次分析');
  assert.equal(app.fetchCount, 0);
  assert.equal(app.sent, undefined);
});

test('延迟返回的缓存不能覆盖用户重新分析或更新后的评测状态', async () => {
  const callbacks = [];
  const app = setup('答案错误', { ok: true }, undefined, url, problemUrl,
    callback => callbacks.push(callback));
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  assert.equal(callbacks.length, 1);
  shadow.querySelector('button').click();
  callbacks[0]({ ok: true, answer: '过期缓存' });
  assert.equal(shadow.querySelector('.result').hidden, true);
  await flush();
  app.emit({ type: 'DELTA', text: '新分析' });
  app.emit({ type: 'DONE' });
  assert.equal(shadow.querySelector('.result').textContent.trim(), '新分析');

  const pending = setup('答案错误', { ok: true }, undefined, url, problemUrl,
    callback => callbacks.push(callback));
  pending.document.querySelector('#tabs-testcase-judging .card-body > div').textContent = '#001 答案正确';
  await flush();
  callbacks[1]({ ok: true, answer: '过期缓存' });
  const pendingShadow = pending.document.getElementById('neuoj-helper-root').shadowRoot;
  assert.equal(pendingShadow.querySelector('.result').hidden, true);
  assert.equal(pendingShadow.querySelector('.status').textContent, '恭喜，成功 AC 这道题');
});

test('评测状态短暂变化后仅接受最新一次缓存读取', async () => {
  const callbacks = [];
  const app = setup('答案错误', { ok: true }, undefined, url, problemUrl,
    callback => callbacks.push(callback));
  const heading = app.document.querySelector('#tabs-testcase-judging .card-body > div');
  heading.textContent = '#001 评测中';
  await flush();
  heading.textContent = '#001 答案错误';
  await flush();
  assert.equal(callbacks.length, 2);
  callbacks[0]({ ok: true, answer: '旧回调' });
  callbacks[1]({ ok: true, answer: '最新缓存' });
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  assert.equal(shadow.querySelector('.result').textContent.trim(), '最新缓存');
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
  app.emit({ type: 'DELTA', text: '<img src=x onerror=alert(1)> [危险](javascript:alert(1)) ![图片](https://example.com/a.png) [安全](https://example.com) $\\href{javascript:alert(1)}{危险}$ $\\includegraphics{https://example.com/a.png}$' });
  app.emit({ type: 'DONE' });
  const result = shadow.querySelector('.result');
  assert.equal(result.querySelector('img'), null);
  assert.equal(result.querySelector('[onerror]'), null);
  assert.equal(result.querySelector('a[href^="javascript:"]'), null);
  assert.match(result.textContent, /<img src=x/);
  const safe = result.querySelector('a');
  assert.equal(result.querySelectorAll('a').length, 1);
  assert.equal(safe.getAttribute('href'), 'https://example.com');
  assert.equal(safe.getAttribute('target'), '_blank');
  assert.equal(safe.getAttribute('rel'), 'noopener noreferrer');
});

test('流式结果渲染四种公式，代码块保持原样，样式从扩展本地加载', async () => {
  const app = setup('答案错误');
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  const stylesheets = [...shadow.querySelectorAll('link[rel="stylesheet"]')].map(link => link.href);
  assert.deepEqual(stylesheets, [
    'chrome-extension://neuoj-helper/vendor/katex/katex.min.css',
    'chrome-extension://neuoj-helper/vendor/texmath/texmath.css'
  ]);
  shadow.querySelector('button').click();
  await flush();
  app.emit({ type: 'DELTA', text: '组合数 $\\bin' });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(shadow.querySelector('.result .katex'), null);
  app.emit({ type: 'DELTA', text: 'om{n+m-1}{m}$，另有 \\(x^2\\)。\n\n$$\\frac{a}{b}$$\n\n\\[\\sum_{i=1}^{n}i\\]\n\n`$raw$`\n\n```text\n\\(raw\\)\n```' });
  app.emit({ type: 'DONE' });
  const result = shadow.querySelector('.result');
  const formulas = [...result.querySelectorAll('.katex-mathml annotation')].map(node => node.textContent);
  assert.deepEqual(formulas, ['\\binom{n+m-1}{m}', 'x^2', '\\frac{a}{b}', '\\sum_{i=1}^{n}i']);
  assert.equal(result.querySelectorAll('.katex-display').length, 2);
  assert.equal(result.querySelector('p code').textContent, '$raw$');
  assert.match(result.querySelector('pre code').textContent, /\\\(raw\\\)/);
});

test('缓存中的公式重新进入页面后仍被渲染，无效公式不妨碍后续内容', () => {
  const app = setup('答案错误', { ok: true }, undefined, url, problemUrl,
    '正确：$x^2$。无效：$\\notacommand$。结尾：**保留**');
  const result = app.document.getElementById('neuoj-helper-root').shadowRoot.querySelector('.result');
  assert.equal(result.querySelector('.katex-mathml annotation').textContent, 'x^2');
  assert.match(result.textContent, /\\notacommand/);
  assert.equal(result.querySelector('strong').textContent, '保留');
});

test('直连提交页也渲染已缓存的公式', () => {
  const app = setup('答案错误', { ok: true }, undefined, directGeneralUrl, directGeneralProblemUrl, '$\\binom{n}{m}$');
  const result = app.document.getElementById('neuoj-helper-root').shadowRoot.querySelector('.result');
  assert.equal(result.querySelector('.katex-mathml annotation').textContent, '\\binom{n}{m}');
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
    assert.equal(button.textContent, '取消');
    assert.equal(button.disabled, false);
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

test('全 AC 保留面板和成功状态，但不能分析或读取缓存', () => {
  const app = setup('答案正确');
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  const button = shadow.querySelector('button');
  assert.equal(button.disabled, true);
  assert.equal(shadow.querySelector('.status').dataset.state, 'success');
  assert.equal(shadow.querySelector('.status').textContent, '恭喜，成功 AC 这道题');
  button.click();
  assert.equal(app.fetchCount, 0);
  assert.equal(app.sent, undefined);
  assert.equal(shadow.querySelector('.result').hidden, true);
});

test('通用提交页失败时可分析，AC 时显示禁用面板', async () => {
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
    const acceptedShadow = accepted.document.getElementById('neuoj-helper-root').shadowRoot;
    assert.equal(acceptedShadow.querySelector('button').disabled, true);
    assert.equal(acceptedShadow.querySelector('.status').textContent, '恭喜，成功 AC 这道题');
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

test('测试点持续等待时编译出错可点击分析', async () => {
  const app = setup('等待评测');
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  const button = shadow.querySelector('button');
  assert.equal(button.disabled, true);
  const compilePane = app.document.getElementById('tabs-compile-info');
  compilePane.querySelector('.card-header').textContent = '编译信息 编译出错';
  compilePane.insertAdjacentHTML('beforeend', '<div id="output_compile"><pre><code>main.cpp:1:6: error: expected declaration</code></pre></div>');
  await flush();
  assert.equal(button.disabled, false);
  assert.equal(shadow.querySelector('.status').hidden, true);
  assert.equal(app.fetchCount, 0);
  button.click();
  await flush();
  assert.equal(app.sent.type, 'ANALYZE');
  assert.match(app.sent.prompt, /提交状态：CE/);
  assert.match(app.sent.prompt, /expected declaration/);
  app.emit({ type: 'DONE' });
});

test('评测中转为 AC 时保留面板并禁用分析', async () => {
  const app = setup('评测中');
  const host = app.document.getElementById('neuoj-helper-root');
  app.document.querySelector('#tabs-testcase-judging .card-body > div').textContent = '#001 答案正确';
  await flush();
  assert.equal(app.document.getElementById('neuoj-helper-root'), host);
  assert.equal(host.shadowRoot.querySelector('button').disabled, true);
  assert.equal(host.shadowRoot.querySelector('.status').textContent, '恭喜，成功 AC 这道题');
  assert.equal(app.fetchCount, 0);
});

test('未知评测结果显示解析错误且不允许发起请求', () => {
  const app = setup('未定义结果');
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  assert.equal(shadow.querySelector('button').disabled, true);
  assert.match(shadow.querySelector('.status').textContent, /无法识别评测结果/);
  assert.equal(app.fetchCount, 0);
});

test('题面请求即使不响应取消信号，超时后也恢复手动重试', async () => {
  let expire;
  let aborted = false;
  let calls = 0;
  const timers = {
    setTimeout(fn, delay) {
      if (delay === 30000) { expire = fn; return 123456; }
      return setTimeout(fn, delay);
    },
    clearTimeout(id) { if (id !== 123456) clearTimeout(id); }
  };
  const app = setup('答案错误', { ok: true }, (_, options) => {
    calls++;
    options.signal.addEventListener('abort', () => { aborted = true; });
    return calls === 1 ? new Promise(() => {})
      : Promise.resolve({ ok: true, url: problemUrl, text: async () => problemHtml });
  }, url, problemUrl, null, timers);
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  const button = shadow.querySelector('button');
  button.click();
  assert.equal(button.textContent, '取消');
  expire();
  await flush();
  assert.equal(aborted, true);
  assert.equal(button.disabled, false);
  assert.match(shadow.querySelector('.status').textContent, /超时/);
  button.click();
  await flush();
  assert.equal(calls, 2);
  assert.equal(app.sent.type, 'ANALYZE');
  app.emit({ type: 'DONE' });
});

test('取消题面请求后可重试，旧请求返回不会覆盖新分析', async () => {
  let resolveOld;
  let firstSignal;
  let calls = 0;
  const app = setup('答案错误', { ok: true }, (_, options) => {
    calls++;
    if (calls === 1) {
      firstSignal = options.signal;
      return new Promise(resolve => { resolveOld = resolve; });
    }
    return Promise.resolve({ ok: true, url: problemUrl, text: async () => problemHtml });
  });
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  const button = shadow.querySelector('button');
  button.click();
  button.click();
  assert.equal(firstSignal.aborted, true);
  assert.equal(button.disabled, false);
  button.click();
  await flush();
  assert.equal(app.sent.type, 'ANALYZE');
  resolveOld({ ok: true, url: problemUrl, text: async () => problemHtml });
  await flush();
  assert.equal(app.sent.type, 'ANALYZE');
  app.emit({ type: 'DONE' });
});

test('评测状态变化会取消在途题面请求并忽略迟到结果', async () => {
  let resolveProblem;
  let signal;
  const app = setup('答案错误', { ok: true }, (_, options) => {
    signal = options.signal;
    return new Promise(resolve => { resolveProblem = resolve; });
  });
  const shadow = app.document.getElementById('neuoj-helper-root').shadowRoot;
  shadow.querySelector('button').click();
  app.document.querySelector('#tabs-testcase-judging .card-body > div').textContent = '#001 答案正确';
  await flush();
  assert.equal(signal.aborted, true);
  assert.equal(shadow.querySelector('button').disabled, true);
  assert.match(shadow.querySelector('.status').textContent, /成功 AC/);
  resolveProblem({ ok: true, url: problemUrl, text: async () => problemHtml });
  await flush();
  assert.equal(app.sent, undefined);
});

test('先出现 AC 测试点、后出现失败点时恢复分析能力', async () => {
  const app = setup('答案正确');
  const host = app.document.getElementById('neuoj-helper-root');
  app.document.querySelector('#tabs-testcase-judging .card-body > div').textContent = '#001 答案错误';
  await flush();
  assert.equal(app.document.getElementById('neuoj-helper-root'), host);
  assert.equal(host.shadowRoot.querySelector('button').disabled, false);
  assert.equal(host.shadowRoot.querySelector('.status').hidden, true);
});
