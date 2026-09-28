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
function bridgeSetup({ status = 200, capabilities = { protocolVersion: 1, capabilities: ['importProblem', 'submitCode'] }, connected = true, tabHandler, tabLookup } = {}) {
  const requests = [];
  const session = {};
  const chrome = {
    runtime: { onInstalled: { addListener() { } }, onStartup: { addListener() { } }, onMessage: { addListener() { } }, onConnect: { addListener() { } } },
    action: { onClicked: { addListener() { } } },
    tabs: {
      async get(id) { return tabLookup ? tabLookup(id) : { id }; },
      async sendMessage(id, message) { if (!tabHandler) throw new Error('无标签页'); return tabHandler(id, message); }
    },
    storage: {
      local: { async get() { throw new Error('导入不应读取设置'); } }, session: {
        async get(key) { return { [key]: session[key] }; },
        async set(value) { Object.assign(session, value); }
      }
    }
  };
  const context = vm.createContext({
    chrome, URL, AbortController, setTimeout, clearTimeout, console, TypeError,
    crypto: require('node:crypto').webcrypto,
    fetch: async (url, options) => {
      requests.push({ url, options }); if (!connected) throw new TypeError('network');
      return new Response(JSON.stringify(url.endsWith('capabilities') ? capabilities : { ok: true }), { status });
    }
  });
  vm.runInContext(fs.readFileSync('extension/src/background.js', 'utf8'), context);
  return { context, requests };
}
test('后台导入先验证协议且保持原有消息边界', async () => {
  const app = bridgeSetup();
  const problem = core.extractIdeProblem(new JSDOM(html).window.document, 'https://oj.neu.edu.cn/problems/83');
  assert.equal((await app.context.importToIde(problem, { url: problem.url, tab: { id: 10 } })).ok, true);
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[0].url, 'http://127.0.0.1:27121/v1/capabilities');
  assert.equal(app.requests[0].options.headers.Authorization, undefined);
  assert.match(app.requests[0].options.headers['X-NEUOJ-Pair'], /^[a-f0-9]{64}$/);
  await assert.rejects(app.context.importToIde(problem, { url: 'https://other.example/problems/83' }), /无效/);
});
test('后台连接和协议失败有明确反馈', async () => {
  const problem = core.extractIdeProblem(new JSDOM(html).window.document, 'https://oj.neu.edu.cn/problems/83');
  for (const [options, pattern] of [[{ status: 403 }, /来源/], [{ status: 409 }, /本地代码文件/], [{ connected: false }, /无法连接/], [{ capabilities: { protocolVersion: 2 } }, /不兼容/]]) {
    await assert.rejects(bridgeSetup(options).context.importToIde(problem, { url: problem.url, tab: { id: 10 } }), pattern);
  }
});
test('后台只向同一访问入口的已登记标签页发送提交任务', async () => {
  const sent = [];
  const app = bridgeSetup({
    tabHandler: async (id, message) => {
      sent.push({ id, message });
      return { ok: true, url: 'https://oj.neu.edu.cn/submissions/123' };
    }
  });
  const direct = 'https://oj.neu.edu.cn/problems/83';
  const vpn = `https://webvpn.neu.edu.cn${prefix}/problems/83`;
  await app.context.rememberBridgeTab({ url: direct, tab: { id: 10 } });
  await app.context.rememberBridgeTab({ url: vpn, tab: { id: 11 } });
  const job = { id: 'task', problemId: direct, url: direct, language: 'C++14', source: 'int main(){}' };
  const result = await app.context.dispatchSubmission(job);
  assert.equal(result.ok, true);
  assert.equal(sent[0].id, 10);
  assert.equal(sent[0].message.job.source, job.source);
  const bad = await app.context.dispatchSubmission({ ...job, url: `https://webvpn.neu.edu.cn/https/other/problems/83` });
  assert.equal(bad.ok, false);
  assert.equal(sent.length, 1);
  assert.equal((await app.context.dispatchSubmission({ ...job, url: vpn, problemId: `webvpn:/problems/83` })).ok, true);
  assert.equal(sent[1].id, 11);
});
test('提交响应丢失后不改用另一标签页重发源码', async () => {
  const sent = [];
  const app = bridgeSetup({ tabHandler: async id => { sent.push(id); throw new Error('连接中断'); } });
  const url = 'https://oj.neu.edu.cn/problems/83';
  await app.context.rememberBridgeTab({ url, tab: { id: 10 } });
  await app.context.rememberBridgeTab({ url, tab: { id: 11 } });
  const result = await app.context.dispatchSubmission({ id: 'once', problemId: url, url, language: 'C', source: 'int main(){}' });
  assert.equal(result.ok, false);
  assert.equal(result.error, '请在 NEUOJ 提交记录中核对提交结果。');
  assert.deepEqual(sent, [11]);
});
test('最新标签页已关闭时改用同入口仍存在的标签页', async () => {
  const sent = [];
  const app = bridgeSetup({
    tabLookup: async id => {
      if (id === 11) throw new Error('标签页已关闭');
      return { id, url: 'https://oj.neu.edu.cn/problems/83' };
    },
    tabHandler: async id => { sent.push(id); return { ok: true, url: 'https://oj.neu.edu.cn/submissions/123' }; }
  });
  const url = 'https://oj.neu.edu.cn/problems/83';
  await app.context.rememberBridgeTab({ url, tab: { id: 10 } });
  await app.context.rememberBridgeTab({ url, tab: { id: 11 } });
  const result = await app.context.dispatchSubmission({ id: 'once', problemId: url, url, language: 'C', source: 'int main(){}' });
  assert.equal(result.ok, true);
  assert.deepEqual(sent, [10]);
});
test('已登记标签页跳到另一访问入口时不向其发送源码', async () => {
  const sent = [];
  const url = 'https://oj.neu.edu.cn/problems/83';
  const app = bridgeSetup({
    tabLookup: async id => ({ id, url: id === 11 ? `https://webvpn.neu.edu.cn${prefix}/problems/83` : url }),
    tabHandler: async id => { sent.push(id); return { ok: true, url: 'https://oj.neu.edu.cn/submissions/123' }; }
  });
  await app.context.rememberBridgeTab({ url, tab: { id: 10 } });
  await app.context.rememberBridgeTab({ url, tab: { id: 11 } });
  const result = await app.context.dispatchSubmission({ id: 'once', problemId: url, url, language: 'C', source: 'int main(){}' });
  assert.equal(result.ok, true);
  assert.deepEqual(sent, [10]);
});
test('题目页仅在点击后发送导入消息，缺少样例反馈错误', async () => {
  const dom = new JSDOM(html, { url: 'https://oj.neu.edu.cn/problems/83', runScripts: 'outside-only' });
  const messages = [];
  dom.window.NEUOJCore = core;
  dom.window.chrome = { runtime: { onMessage: { addListener() { } }, sendMessage(message, callback) { messages.push(message); callback?.({ ok: true }); } } };
  dom.window.eval(fs.readFileSync('extension/src/ide-content.js', 'utf8'));
  assert.equal(messages.filter(message => message.type === 'IDE_IMPORT').length, 0);
  const shadow = dom.window.document.getElementById('neuoj-ide-import').shadowRoot;
  assert.equal(shadow.querySelectorAll('button').length, 1);
  assert.equal(shadow.querySelector('button').textContent, '导入题目');
  assert.equal(shadow.querySelector('button').getAttribute('style'), null);
  assert.ok(shadow.querySelector('.panel > .top > .actions > button'));
  assert.equal(shadow.querySelector('.status').hidden, true);
  const analysisStyle = fs.readFileSync('extension/src/content.js', 'utf8');
  for (const rule of ['.panel { border:', '.top { display:flex;', '.actions { display:flex;', 'button { box-sizing:border-box;', 'button:hover:not(:disabled)', 'button:disabled', 'button:focus-visible']) {
    const css = analysisStyle.slice(analysisStyle.indexOf(rule), analysisStyle.indexOf('}', analysisStyle.indexOf(rule)) + 1);
    assert.ok(shadow.querySelector('style').textContent.includes(css));
  }
  shadow.querySelector('button').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.find(message => message.type === 'IDE_IMPORT').type, 'IDE_IMPORT');
  assert.equal(shadow.querySelector('[role="status"]').textContent, '已导入 IDE');
  dom.window.document.querySelector('#example-output').remove();
  shadow.querySelector('button').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.filter(message => message.type === 'IDE_IMPORT').length, 1);
  assert.match(shadow.querySelector('[role="status"]').textContent, /样例/);
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  dom.window.close();
});
test('WebVPN 题目页点击导入时发送对应代理题目', async () => {
  const dom = new JSDOM(html, { url: `https://webvpn.neu.edu.cn${prefix}/exam/46/problem/F`, runScripts: 'outside-only' });
  const messages = [];
  dom.window.NEUOJCore = core;
  dom.window.chrome = { runtime: { onMessage: { addListener() { } }, sendMessage(message, callback) { messages.push(message); callback?.({ ok: true }); } } };
  dom.window.eval(fs.readFileSync('extension/src/ide-content.js', 'utf8'));
  dom.window.document.getElementById('neuoj-ide-import').shadowRoot.querySelector('button').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.filter(message => message.type === 'IDE_IMPORT').length, 1);
  assert.equal(messages.find(message => message.type === 'IDE_IMPORT').problem.id, 'webvpn:/exam/46/problem/F');
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  dom.window.close();
});
for (const base of ['https://oj.neu.edu.cn', `https://webvpn.neu.edu.cn${prefix}`]) {
  test(`静态 HTML 无源码框仍沿用 NEUOJ 表单：${base.includes('webvpn') ? '代理访问' : '常规访问'}`, async () => {
    const problemUrl = `${base}/problems/83`;
    const dom = new JSDOM(html, { url: problemUrl, runScripts: 'outside-only' });
    const requests = [];
    let submitMessage;
    dom.window.NEUOJCore = core;
    dom.window.chrome = {
      runtime: {
        onMessage: { addListener(listener) { submitMessage = listener; } },
        sendMessage(_message, callback) { callback?.({ ok: true }); }
      }
    };
    dom.window.fetch = async (url, options) => {
      requests.push({ url, options });
      if (!options || options.method !== 'POST') return {
        ok: true, url: problemUrl, text: async () => `
        <form action="${problemUrl}" method="POST">
          <input name="_token" value="csrf-test"><select name="language_id">
            <option value="1">C(gcc)</option><option value="3">C++14</option>
          </select><div id="source_code"></div></form>` };
      return { ok: true, url: `${base}/submissions/123`, text: async () => '' };
    };
    dom.window.eval(fs.readFileSync('extension/src/ide-content.js', 'utf8'));
    const submit = job => new Promise(resolve => submitMessage({ type: 'IDE_SUBMIT', job }, {}, resolve));
    for (const [language, expectedId] of [['C', '1'], ['C++14', '3']]) {
      const result = await submit({
        id: 'task', problemId: core.problemIdentity(problemUrl).id,
        url: problemUrl, language, source: 'int main(void) { return 0; }'
      });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.url, `${base}/submissions/123`);
      const request = requests.at(-1);
      assert.equal(request.url, problemUrl);
      assert.equal(request.options.credentials, 'same-origin');
      const body = new URLSearchParams(request.options.body);
      assert.equal(body.get('_token'), 'csrf-test');
      assert.equal(body.get('language_id'), expectedId);
      assert.equal(body.get('source_code'), 'int main(void) { return 0; }');
    }
    const count = requests.length;
    const invalid = await submit({
      id: 'bad', problemId: 'webvpn:/problems/83',
      url: 'https://webvpn.neu.edu.cn/https/other/problems/83', language: 'C', source: 'a'
    });
    assert.equal(invalid.ok, false);
    assert.equal(requests.length, count);
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    dom.window.close();
  });
}
for (const base of ['https://oj.neu.edu.cn', `https://webvpn.neu.edu.cn${prefix}`]) {
  test(`优先使用当前题目已渲染的提交表单：${base.includes('webvpn') ? '代理访问' : '常规访问'}`, async () => {
    const url = `${base}/training/1/part/4/problem/9`;
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    dom.window.document.body.insertAdjacentHTML('beforeend', `<form action="${url}" method="POST">
      <input name="_token" value="live-csrf"><select name="language_id"><option value="1">C(gcc)</option></select>
      <textarea name="source_code"></textarea></form>`);
    let submitMessage;
    let posted;
    dom.window.NEUOJCore = core;
    dom.window.chrome = {
      runtime: {
        onMessage: { addListener(listener) { submitMessage = listener; } },
        sendMessage(_message, callback) { callback?.({ ok: true }); }
      }
    };
    dom.window.fetch = async (target, options) => {
      if (options?.method === 'POST') {
        posted = { target, body: new URLSearchParams(options.body) };
        return { ok: true, url: `${base}/training/1/submission/777` };
      }
      return { ok: true, url, text: async () => { throw new Error('已渲染表单无需解析静态 HTML'); } };
    };
    dom.window.eval(fs.readFileSync('extension/src/ide-content.js', 'utf8'));
    const result = await new Promise(resolve => submitMessage({
      type: 'IDE_SUBMIT', job: {
        id: 'x', problemId: core.problemIdentity(url).id, url, language: 'C', source: 'int main(void) { return 0; }'
      }
    }, {}, resolve));
    assert.equal(result.ok, true, result.error);
    assert.equal(posted.target, url);
    assert.equal(posted.body.get('_token'), 'live-csrf');
    assert.equal(posted.body.get('source_code'), 'int main(void) { return 0; }');
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    dom.window.close();
  });
}
for (const base of ['https://oj.neu.edu.cn', `https://webvpn.neu.edu.cn${prefix}`]) {
  test(`训练题目表单提交至当前题目：${base.includes('webvpn') ? '代理访问' : '常规访问'}`, async () => {
    const url = `${base}/training/1/part/4/problem/9`;
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    let submitMessage;
    let posted;
    dom.window.NEUOJCore = core;
    dom.window.chrome = {
      runtime: {
        onMessage: { addListener(listener) { submitMessage = listener; } },
        sendMessage(_message, callback) { callback?.({ ok: true }); }
      }
    };
    let formAction = url;
    dom.window.fetch = async (target, options) => {
      if (options?.method === 'POST') {
        posted = target;
        return { ok: true, url: `${base}/training/1/submission/777` };
      }
      return { ok: true, url, text: async () => `<form action="${formAction}" method="POST"><input name="_token" value="csrf"><select name="language_id"><option value="1">C(gcc)</option></select><textarea name="source_code"></textarea></form>` };
    };
    dom.window.eval(fs.readFileSync('extension/src/ide-content.js', 'utf8'));
    const job = { id: 'x', problemId: core.problemIdentity(url).id, url, language: 'C', source: 'int main(void) { return 0; }' };
    const submit = () => new Promise(resolve => submitMessage({ type: 'IDE_SUBMIT', job }, {}, resolve));
    const initial = await submit();
    assert.equal(initial.ok, true, initial.error);
    assert.equal(posted, url);
    formAction = '/training/1/part/4/problem/9';
    posted = null;
    assert.equal((await submit()).ok, true);
    assert.equal(posted, url);
    if (base.includes('webvpn')) {
      formAction = 'https://oj.neu.edu.cn/training/1/part/4/problem/9';
      posted = null;
      assert.equal((await submit()).ok, true);
      assert.equal(posted, url);
      formAction = 'https://webvpn.neu.edu.cn/https/other/training/1/part/4/problem/9';
      posted = null;
      assert.equal((await submit()).ok, false);
      assert.equal(posted, null);
    }
    formAction = `${base}/training/1/part/4/problem/10`;
    posted = null;
    const invalid = await submit();
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /表单已变化/);
    assert.equal(posted, null);
    formAction = `${base}/trainings/1/parts/4/problems/10/submissions`;
    posted = null;
    assert.equal((await submit()).ok, false);
    assert.equal(posted, null);
    formAction = `${base}/trainings/2/parts/4/problems/9/submissions`;
    assert.equal((await submit()).ok, false);
    assert.equal(posted, null);
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    dom.window.close();
  });
}
test('提交页跳转登录或未返回提交详情时不报告成功', async () => {
  const url = 'https://oj.neu.edu.cn/problems/83';
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  let submitMessage;
  dom.window.NEUOJCore = core;
  dom.window.chrome = { runtime: { onMessage: { addListener(listener) { submitMessage = listener; } }, sendMessage(_m, callback) { callback?.({ ok: true }); } } };
  dom.window.fetch = async () => ({ ok: true, url: 'https://oj.neu.edu.cn/login', text: async () => '' });
  dom.window.eval(fs.readFileSync('extension/src/ide-content.js', 'utf8'));
  const result = await new Promise(resolve => submitMessage({
    type: 'IDE_SUBMIT', job: {
      id: 'x', problemId: core.problemIdentity(url).id, url, language: 'C++14', source: 'int main(){}'
    }
  }, {}, resolve));
  assert.equal(result.ok, false);
  assert.match(result.error, /登录/);
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  dom.window.close();
});
test('站点接受请求但只跳转记录页时提示核对且只提交一次', async () => {
  const url = 'https://oj.neu.edu.cn/training/1/part/4/problem/9';
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  let submitMessage;
  let posts = 0;
  dom.window.NEUOJCore = core;
  dom.window.chrome = { runtime: { onMessage: { addListener(listener) { submitMessage = listener; } }, sendMessage(_m, callback) { callback?.({ ok: true }); } } };
  dom.window.fetch = async (_target, options) => {
    if (options?.method === 'POST') { posts++; return { ok: true, url: 'https://oj.neu.edu.cn/training/1/status', text: async () => '' }; }
    return { ok: true, url, text: async () => '<form method="POST" action="/training/1/part/4/problem/9"><input name="_token" value="csrf"><select name="language_id"><option value="1">C(gcc)</option></select></form>' };
  };
  dom.window.eval(fs.readFileSync('extension/src/ide-content.js', 'utf8'));
  const result = await new Promise(resolve => submitMessage({
    type: 'IDE_SUBMIT', job: {
      id: 'x', problemId: core.problemIdentity(url).id, url, language: 'C', source: 'int main(void) { return 0; }'
    }
  }, {}, resolve));
  assert.equal(result.ok, false);
  assert.equal(result.error, '请在 NEUOJ 提交记录中核对提交结果。');
  assert.equal(posts, 1);
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  dom.window.close();
});
test('表单令牌由页面元数据提供时仍能提交', async () => {
  const url = 'https://oj.neu.edu.cn/problems/83';
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  let submitMessage;
  let posted;
  dom.window.NEUOJCore = core;
  dom.window.chrome = { runtime: { onMessage: { addListener(listener) { submitMessage = listener; } }, sendMessage(_m, callback) { callback?.({ ok: true }); } } };
  dom.window.fetch = async (_target, options) => {
    if (options?.method === 'POST') {
      posted = new URLSearchParams(options.body);
      return { ok: true, url: 'https://oj.neu.edu.cn/submissions/5' };
    }
    return { ok: true, url, text: async () => '<meta name="csrf-token" content="meta-csrf"><form method="POST" action="/problems/83/submissions"><input name="_token"><select name="language_id"><option value="3">C++14</option></select><textarea name="source_code"></textarea></form>' };
  };
  dom.window.eval(fs.readFileSync('extension/src/ide-content.js', 'utf8'));
  const result = await new Promise(resolve => submitMessage({
    type: 'IDE_SUBMIT', job: {
      id: 'x', problemId: url, url, language: 'C++14', source: 'int main(){}'
    }
  }, {}, resolve));
  assert.equal(result.ok, true);
  assert.equal(posted.get('_token'), 'meta-csrf');
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  dom.window.close();
});
for (const base of ['https://oj.neu.edu.cn', `https://webvpn.neu.edu.cn${prefix}`]) {
  test(`普通题目拒绝指向其他题号的提交表单：${base.includes('webvpn') ? '代理访问' : '常规访问'}`, async () => {
    const url = `${base}/problems/83`;
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    let submitMessage;
    let posts = 0;
    dom.window.NEUOJCore = core;
    dom.window.chrome = { runtime: { onMessage: { addListener(listener) { submitMessage = listener; } }, sendMessage(_m, callback) { callback?.({ ok: true }); } } };
    dom.window.fetch = async (_target, options) => {
      if (options?.method === 'POST') { posts++; return { ok: true, url: `${base}/submissions/123` }; }
      return { ok: true, url, text: async () => '<form method="POST" action="/problems/84/submissions"><input name="_token" value="csrf"><select name="language_id"><option value="1">C(gcc)</option></select></form>' };
    };
    dom.window.eval(fs.readFileSync('extension/src/ide-content.js', 'utf8'));
    const result = await new Promise(resolve => submitMessage({ type: 'IDE_SUBMIT', job: {
      id: 'x', problemId: core.problemIdentity(url).id, url, language: 'C', source: 'int main(){}'
    } }, {}, resolve));
    assert.equal(result.ok, false);
    assert.equal(posts, 0);
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    dom.window.close();
  });
}
for (const base of ['https://oj.neu.edu.cn', `https://webvpn.neu.edu.cn${prefix}`]) {
  test(`训练题目使用网页给出的多级提交地址：${base.includes('webvpn') ? '代理访问' : '常规访问'}`, async () => {
    const url = `${base}/training/8/part/68/problem/286`;
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    let submitMessage;
    let action;
    dom.window.NEUOJCore = core;
    dom.window.chrome = { runtime: { onMessage: { addListener(listener) { submitMessage = listener; } }, sendMessage(_m, callback) { callback?.({ ok: true }); } } };
    dom.window.fetch = async (target, options) => {
      if (options?.method === 'POST') { action = target; return { ok: true, url: `${base}/training/8/submissions/777` }; }
      return { ok: true, url, text: async () => '<form method="POST" action="/trainings/8/parts/68/problems/286/submissions"><input name="_token" value="csrf"><select name="language_id"><option value="3">C++14</option></select><textarea name="source_code"></textarea></form>' };
    };
    dom.window.eval(fs.readFileSync('extension/src/ide-content.js', 'utf8'));
    const result = await new Promise(resolve => submitMessage({
      type: 'IDE_SUBMIT', job: {
        id: 'x', problemId: core.problemIdentity(url).id, url, language: 'C++14', source: 'int main(){}'
      }
    }, {}, resolve));
    assert.equal(result.ok, true);
    assert.equal(action, `${base}/trainings/8/parts/68/problems/286/submissions`);
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    dom.window.close();
  });
}
test('Web 设置页与 main 保持一致且无 IDE 连接设置', () => {
  const html = fs.readFileSync('extension/src/options.html', 'utf8');
  const dom = new JSDOM(html);
  assert.equal(dom.window.document.getElementById('ide-settings'), null);
  assert.equal(dom.window.document.getElementById('testConnection').textContent, '测试连接');
  assert.deepEqual([...dom.window.document.querySelectorAll('script')].map(script => script.getAttribute('src')), ['options.js']);
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
