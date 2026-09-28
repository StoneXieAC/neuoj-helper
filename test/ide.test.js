const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../extension/src/core');
const prefix = '/https/62304135386136393339346365373340bfebea318fd008d8f60d257088';
const html = `<div class="col-7"><div class="card mb-2"><div class="card-header"><span class="nav-link"><strong>测试题</strong></span></div></div>
<div class="card-header">1S 512 MB</div><div id="problem-content-vditor">测试题面<img src="https://oj.neu.edu.cn/img/test.png"></div>
<div id="example-input">\n    8<br>\n    0 1<br>\n    0 2\n  </div><pre id="example-output"> 1\n\n2 \n</pre></div>`;
for (const base of ['https://oj.neu.edu.cn', `https://webvpn.neu.edu.cn${prefix}`]) {
  test(`NEUOJ 题目导入与样例保真：${base.includes('webvpn') ? '代理兼容' : '常规访问'}`, () => {
    const doc = new JSDOM(html).window.document;
    const problem = core.extractIdeProblem(doc, `${base}/training/2/part/1/problem/83?q=1#f`);
    assert.equal(problem.samples[0].input, '8\n0 1\n0 2');
    assert.equal(problem.samples[0].output, ' 1\n\n2 \n');
    assert.equal(problem.timeLimitMs, 1000);
    assert.equal(problem.memoryLimitMb, 512);
    assert.equal(problem.title, '测试题');
    assert.ok(!problem.url.includes('#'));
    assert.equal(problem.images[0], `${base}/img/test.png`);
    doc.querySelector('#example-output').remove();
    assert.throws(() => core.extractIdeProblem(doc, `${base}/problems/83`), /样例/);
  });
}
test('题目 URL 校验涵盖范围并拒绝无效地址', () => {
  for (const path of ['/problems/83', '/training/2/part/1/problem/83', '/group/2/problem/A', '/contest/3/problem/B', '/exam/46/problem/F']) {
    assert.ok(core.problemIdentity(`https://oj.neu.edu.cn${path}`));
    assert.ok(core.problemIdentity(`https://webvpn.neu.edu.cn${prefix}${path}`));
  }
  for (const url of ['http://oj.neu.edu.cn/problems/83', 'https://user@oj.neu.edu.cn/problems/83', 'https://webvpn.neu.edu.cn/proble ms/83', 'https://webvpn.neu.edu.cn/https/other/problems/83', 'https://oj.neu.edu.cn/submission/1']) assert.equal(core.problemIdentity(url), null);
  assert.throws(() => core.extractIdeProblem(new JSDOM('').window.document, 'https://oj.neu.edu.cn/problems/83'), /识别/);
});
test('多样例保留末尾换行并按编号配对', () => {
  const doc = new JSDOM(`<div id="problem-content-vditor">题面</div><pre id="example-input-1"><span>\n a \n</span></pre><pre id="example-output-1"></pre><pre id="example-input-2">b</pre><pre id="example-output-2">b\n</pre>`).window.document;
  const p = core.extractIdeProblem(doc, 'https://oj.neu.edu.cn/problems/83');
  assert.equal(p.samples.length, 2); assert.equal(p.samples[0].input, '\n a \n'); assert.equal(p.samples[0].output, '');
  doc.querySelector('#example-output-2').id = 'example-output-3';
  assert.throws(() => core.extractIdeProblem(doc, p.url), /配对/);
});
function bridgeSetup({ status = 200, capabilities = { protocolVersion: 1, capabilities: ['importProblem'] }, connected = true, granted = true } = {}) {
  const requests = [];
  const chrome = {
    runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} }, onConnect: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
    storage: { local: { async get() { return { idePort: 27121 }; } } },
    permissions: { async contains() { return granted; } }
  };
  const context = vm.createContext({ chrome, URL, AbortController, setTimeout, clearTimeout, console, TypeError,
    fetch: async (url, options) => {
      requests.push({ url, options }); if (!connected) throw new TypeError('network');
      return new Response(JSON.stringify(url.endsWith('capabilities') ? capabilities : { ok: true }), { status });
    } });
  vm.runInContext(fs.readFileSync('extension/src/background.js', 'utf8'), context);
  return { context, requests };
}
test('后台导入先验证协议且保持原有消息边界', async () => {
  const app = bridgeSetup();
  const problem = core.extractIdeProblem(new JSDOM(html).window.document, 'https://oj.neu.edu.cn/problems/83');
  assert.equal((await app.context.importToIde(problem, { url: problem.url })).ok, true);
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[0].options.headers.Authorization, undefined);
  await assert.rejects(app.context.importToIde(problem, { url: 'https://other.example/problems/83' }), /无效/);
});
test('后台连接和协议失败有明确反馈', async () => {
  const problem = core.extractIdeProblem(new JSDOM(html).window.document, 'https://oj.neu.edu.cn/problems/83');
  for (const [options, pattern] of [[{ status: 403 }, /来源/], [{ status: 409 }, /接收项目/], [{ connected: false }, /无法连接/], [{ capabilities: { protocolVersion: 2 } }, /不兼容/], [{ granted: false }, /权限/]]) {
    await assert.rejects(bridgeSetup(options).context.importToIde(problem, { url: problem.url }), pattern);
  }
});
test('题目页仅在点击后发送导入消息，缺少样例反馈错误', async () => {
  const dom = new JSDOM(html, { url: 'https://oj.neu.edu.cn/problems/83', runScripts: 'outside-only' });
  const messages = [];
  dom.window.NEUOJCore = core;
  dom.window.chrome = { runtime: { sendMessage(message, callback) { messages.push(message); callback?.({ ok: true }); } } };
  dom.window.eval(fs.readFileSync('extension/src/ide-content.js', 'utf8'));
  assert.equal(messages.length, 0);
  const shadow = dom.window.document.getElementById('neuoj-ide-import').shadowRoot;
  shadow.querySelector('button').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages[0].type, 'IDE_IMPORT');
  assert.equal(shadow.querySelector('[role="status"]').textContent, '已导入 IDE。');
  dom.window.document.querySelector('#example-output').remove();
  shadow.querySelector('button').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.length, 1);
  assert.match(shadow.querySelector('[role="status"]').textContent, /样例/);
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  dom.window.close();
});
test('IDE 设置独立保存，不要求模型 API 配置', async () => {
  const dom = new JSDOM(fs.readFileSync('extension/src/options.html', 'utf8'), { runScripts: 'outside-only' });
  const saved = {};
  const removed = [];
  dom.window.chrome = {
    storage: { local: { async get() { return { idePort: 27122 }; }, async set(value) { Object.assign(saved, value); }, async remove(key) { removed.push(key); } } },
    permissions: { async request() { throw new Error('不应再要求手动授权'); } }
  };
  dom.window.eval(fs.readFileSync('extension/src/ide-options.js', 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.document.getElementById('idePort').value, '27122');
  assert.deepEqual(removed, ['ideToken']);
  const form = dom.window.document.getElementById('ide-settings');
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.document.getElementById('ideToken'), null);
  assert.equal(saved.idePort, 27122);
  dom.window.document.getElementById('idePort').value = '1';
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(dom.window.document.getElementById('ide-message').textContent, /有效/);
  dom.window.close();
});

test('样例末尾显式换行不被页面缩进清理吞掉', () => {
  const doc = new JSDOM('<div id="a">\n    1<br>\n    </div><div id="b">1\n</div>').window.document;
  assert.equal(core.sampleText(doc.getElementById('a')), '1\n');
  assert.equal(core.sampleText(doc.getElementById('b')), '1\n');
});

test('样例中的页面缩进与内容空格分别处理', () => {
  const doc = new JSDOM('<div id="a">1<br>\n    2<br>  3<br>\n\t4</div><pre id="b">1<br>\n    2</pre>').window.document;
  assert.equal(core.sampleText(doc.getElementById('a')), '1\n2\n  3\n4');
  assert.equal(core.sampleText(doc.getElementById('b')), '1\n    2');
});
