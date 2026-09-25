const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '../extension/src/background.js'), 'utf8');
const systemPrompt = fs.readFileSync(path.join(__dirname, '../extension/prompts/system.md'), 'utf8');
const sender = { url: 'https://webvpn.neu.edu.cn/https/opaque-id/training/8/submission/1716135' };
const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'content-type': 'application/json' }
});
const sseResponse = stream => new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
const bytes = text => new TextEncoder().encode(text);

function setup({ granted = true, apiKey = 'test-secret', reasoningEffort, respond = () => jsonResponse({ choices: [{ message: { content: '分析结果' } }] }), timeout = false } = {}) {
  let messageListener;
  let connectListener;
  let actionClicked;
  let optionsOpened = 0;
  let optionsFocused = 0;
  let popupOptions;
  const windows = new Map();
  const session = {};
  let permissionRequest;
  const requests = [];
  const chrome = {
    runtime: {
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener(fn) { messageListener = fn; } },
      onConnect: { addListener(fn) { connectListener = fn; } },
      getURL(name) { return `chrome-extension://test/${name}`; }
    },
    action: { onClicked: { addListener(fn) { actionClicked = fn; } } },
    windows: {
      async create(options) { optionsOpened++; popupOptions = options; const popup = { id: optionsOpened }; windows.set(popup.id, popup); return popup; },
      async get(id) { if (!windows.has(id)) throw Error('window closed'); return windows.get(id); },
      async update(id, options) { if (!windows.has(id)) throw Error('window closed'); if (options.focused) optionsFocused++; return windows.get(id); }
    },
    storage: {
      local: { async setAccessLevel() {}, async get() { return { baseUrl: 'http://localhost:8765/v1', apiKey, model: 'custom-model', reasoningEffort }; } },
      session: {
        async get(key) { return { [key]: session[key] }; },
        async set(value) { Object.assign(session, value); },
        async remove(key) { delete session[key]; }
      }
    },
    permissions: { async contains(value) { permissionRequest = value; return granted; } }
  };
  const fetch = async (url, options) => {
    if (url === 'chrome-extension://test/prompts/system.md') return new Response(systemPrompt);
    requests.push({ url, options });
    return respond(url, options, requests.length);
  };
  const context = { chrome, fetch, URL, AbortController, TextDecoder, console,
    setTimeout: timeout ? callback => { queueMicrotask(callback); return 1; } : setTimeout,
    clearTimeout: timeout ? () => {} : clearTimeout };
  vm.runInNewContext(script, context);
  return {
    open(message = { type: 'ANALYZE', prompt: '提交状态：WA' }, from = sender) {
      const events = [];
      let onMessage;
      let onDisconnect;
      let complete;
      const done = new Promise(resolve => { complete = resolve; });
      let disconnected = false;
      const port = {
        name: 'NEUOJ_ANALYZE', sender: from,
        onMessage: { addListener(fn) { onMessage = fn; } },
        onDisconnect: { addListener(fn) { onDisconnect = fn; } },
        postMessage(event) { events.push(event); if (event.type === 'DONE' || event.type === 'ERROR') complete(event); },
        disconnect() { if (!disconnected) { disconnected = true; onDisconnect(); } }
      };
      connectListener(port);
      onMessage(message);
      return { events, done, disconnect: () => port.disconnect() };
    },
    async openOptions(from = sender) {
      return new Promise(resolve => { assert.equal(messageListener({ type: 'OPEN_OPTIONS' }, from, resolve), true); });
    },
    async clickAction() { actionClicked(); await new Promise(resolve => setImmediate(resolve)); },
    closeOptions() { windows.delete(session.settingsWindowId); },
    get requests() { return requests; },
    get permissionRequest() { return permissionRequest; },
    get optionsOpened() { return optionsOpened; },
    get optionsFocused() { return optionsFocused; },
    get popupOptions() { return popupOptions; }
  };
}

test('提交页齿轮与工具栏共用设置弹窗，重复打开时聚焦，关闭后可重建', async () => {
  const app = setup();
  assert.equal((await app.openOptions()).ok, true);
  assert.equal(app.optionsOpened, 1);
  assert.equal(app.popupOptions.url, 'chrome-extension://test/src/options.html');
  assert.equal(app.popupOptions.type, 'popup');
  assert.equal(app.popupOptions.width, 480);
  assert.equal(app.popupOptions.height, 560);
  await app.clickAction();
  assert.equal(app.optionsOpened, 1);
  assert.equal(app.optionsFocused, 1);
  app.closeOptions();
  assert.equal((await app.openOptions()).ok, true);
  assert.equal(app.optionsOpened, 2);
  assert.equal(app.requests.length, 0);
  assert.equal((await app.openOptions({ url: 'https://evil.example/submission/1' })).ok, false);
});

test('几乎同时点击设置入口只创建一个弹窗', async () => {
  const app = setup();
  const results = await Promise.all([app.openOptions(), app.openOptions()]);
  assert.ok(results.every(result => result.ok));
  assert.equal(app.optionsOpened, 1);
});

test('流式事件分块、跨字节字符和完成标记逐段传递，提示词独立读取', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = bytes('data: {"choices":[{"delta":{"content":"**可');
  const second = bytes('能**"}}]}\r\n\r\n');
  const app = setup({ respond: () => sseResponse(new ReadableStream({
    async start(controller) {
      controller.enqueue(first);
      controller.enqueue(second);
      await gate;
      const remaining = bytes('data: {"choices":[{"delta":{"content":"位置"}}]}\n\ndata: [DONE]\n\n');
      const split = remaining.indexOf(bytes('位')[0]);
      controller.enqueue(remaining.slice(0, split + 1));
      controller.enqueue(remaining.slice(split + 1));
      controller.close();
    }
  })) });
  const run = app.open();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(run.events.map(event => event.type), ['DELTA']);
  assert.equal(run.events[0].text, '**可能**');
  release();
  assert.equal((await run.done).type, 'DONE');
  assert.deepEqual(run.events.map(event => event.type), ['DELTA', 'DELTA', 'DONE']);
  assert.equal(run.events[1].text, '位置');
  assert.equal(app.permissionRequest.origins[0], 'http://localhost/*');
  assert.equal(app.requests[0].url, 'http://localhost:8765/v1/chat/completions');
  assert.equal(app.requests[0].options.headers.Authorization, 'Bearer test-secret');
  const body = JSON.parse(app.requests[0].options.body);
  assert.equal(body.stream, true);
  assert.equal(body.model, 'custom-model');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.messages[1].content, '提交状态：WA');
  assert.equal(body.messages[0].content, systemPrompt.trim());
  assert.match(body.messages[0].content, /100 字左右|100字左右/);
  assert.match(body.messages[0].content, /Judge.*正确答案/);
  assert.match(body.messages[0].content, /Team.*实际输出/);
  assert.equal('apiKey' in body, false);
});

test('缺少权限、密钥或页面校验失败时不请求模型', async () => {
  for (const [app, from] of [[setup({ granted: false }), sender], [setup({ apiKey: '' }), sender],
    [setup(), { url: 'https://evil.example/submission/1' }]]) {
    assert.equal((await app.open(undefined, from).done).type, 'ERROR');
    assert.equal(app.requests.length, 0);
  }
});

test('明确拒绝 stream 时重试非流式；忽略 stream 的接口直接显示 JSON', async () => {
  const fallback = setup({ respond: (_, __, count) => count === 1
    ? jsonResponse({ error: { message: 'stream is unsupported' } }, 400)
    : jsonResponse({ choices: [{ message: { content: '**原因**' } }] }) });
  const run = fallback.open();
  assert.equal((await run.done).type, 'DONE');
  assert.equal(fallback.requests.length, 2);
  assert.equal(JSON.parse(fallback.requests[0].options.body).stream, true);
  assert.equal(JSON.parse(fallback.requests[1].options.body).stream, false);
  assert.equal(JSON.parse(fallback.requests[0].options.body).reasoning_effort, 'low');
  assert.equal(JSON.parse(fallback.requests[1].options.body).reasoning_effort, 'low');
  assert.equal(run.events[0].text, '**原因**');

  const ignored = setup();
  assert.equal((await ignored.open().done).type, 'DONE');
  assert.equal(ignored.requests.length, 1);

  const plainJson = setup({ respond: () => new Response('{"choices":[{"message":{"content":"纯文本类型的 JSON"}}]}',
    { headers: { 'content-type': 'text/plain' } }) });
  const plainRun = plainJson.open();
  assert.equal((await plainRun.done).type, 'DONE');
  assert.equal(plainRun.events[0].text, '纯文本类型的 JSON');
});

test('自定义思考等级随请求发送，空值时完全省略', async () => {
  const custom = setup({ reasoningEffort: ' minimal ' });
  assert.equal((await custom.open().done).type, 'DONE');
  assert.equal(JSON.parse(custom.requests[0].options.body).reasoning_effort, 'minimal');
  const empty = setup({ reasoningEffort: '' });
  assert.equal((await empty.open().done).type, 'DONE');
  assert.equal('reasoning_effort' in JSON.parse(empty.requests[0].options.body), false);
});

test('后台允许直连和 WebVPN 通用提交页，拒绝伪造路径', async () => {
  for (const url of ['https://oj.neu.edu.cn/submissions/1716650',
    'https://webvpn.neu.edu.cn/https/opaque-id/submissions/1716650']) {
    const app = setup();
    assert.equal((await app.open(undefined, { url }).done).type, 'DONE');
    assert.equal(app.requests.length, 1);
  }
  for (const url of ['https://oj.neu.edu.cn/other/submissions/1716650',
    'https://webvpn.neu.edu.cn/submissions/1716650',
    'https://webvpn.neu.edu.cn/https/opaque-id/submissions/not-a-number']) {
    const app = setup();
    assert.equal((await app.open(undefined, { url }).done).type, 'ERROR');
    assert.equal(app.requests.length, 0);
  }
});

test('已输出部分内容后流中断，保留增量并报告失败', async () => {
  const app = setup({ respond: () => sseResponse(new ReadableStream({ start(controller) {
    controller.enqueue(bytes('data: {"choices":[{"delta":{"content":"部分结论"}}]}\n\n'));
    controller.close();
  } })) });
  const run = app.open();
  assert.match((await run.done).error, /中途断开/);
  assert.deepEqual(run.events.map(event => event.type), ['DELTA', 'ERROR']);
  assert.equal(run.events[0].text, '部分结论');
  assert.equal(app.requests.length, 1);
});

test('鉴权失败、异常 JSON 和超时不重试', async () => {
  const unauthorized = setup({ respond: () => jsonResponse({ error: { message: 'no key' } }, 401) });
  assert.match((await unauthorized.open().done).error, /API Key/);
  assert.equal(unauthorized.requests.length, 1);

  const invalid = setup({ respond: () => new Response('bad', { headers: { 'content-type': 'application/json' } }) });
  assert.match((await invalid.open().done).error, /JSON/);
  assert.equal(invalid.requests.length, 1);

  const stalled = setup({ timeout: true, respond: (_, options) => new Promise((_, reject) => {
    if (options.signal.aborted) reject({ name: 'AbortError' });
    else options.signal.addEventListener('abort', () => reject({ name: 'AbortError' }));
  }) });
  assert.match((await stalled.open().done).error, /超时/);
  assert.equal(stalled.requests.length, 1);
});
