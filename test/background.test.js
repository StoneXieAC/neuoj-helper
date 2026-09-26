const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '../extension/src/background.js'), 'utf8');
const systemPrompt = fs.readFileSync(path.join(__dirname, '../extension/prompts/system.md'), 'utf8');
const sender = { url: 'https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/training/8/submission/1716135' };
const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'content-type': 'application/json' }
});
const sseResponse = stream => new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
const bytes = text => new TextEncoder().encode(text);

function setup({ granted = true, apiKey = 'test-secret', reasoningEffort, customPrompt, respond = () => jsonResponse({ choices: [{ message: { content: '分析结果' } }] }), timeout = false, timers, clock = Date, localStore, failResultWrite = false, supportsAccessLevel = true } = {}) {
  let messageListener;
  let connectListener;
  let actionClicked;
  let optionsOpened = 0;
  let optionsFocused = 0;
  let popupOptions;
  const windows = new Map();
  const session = {};
  const local = localStore || { baseUrl: 'http://localhost:8765/v1', apiKey, model: 'custom-model', reasoningEffort, systemPrompt: customPrompt };
  let permissionRequest;
  const requests = [];
  const loggedErrors = [];
  const chrome = {
    runtime: {
      id: 'test',
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener(fn) { messageListener = fn; } },
      onConnect: { addListener(fn) { connectListener = fn; } },
      getURL(name) { return `chrome-extension://test/${name}`; }
    },
    action: { onClicked: { addListener(fn) { actionClicked = fn; } } },
    windows: {
      async create(options) { optionsOpened++; popupOptions = options; const popup = { id: optionsOpened }; windows.set(popup.id, popup); return popup; },
      async get(id) {
        if (id === 42) return { id, left: 100, top: 80, width: 1200, height: 900 };
        if (id === 43) return { id, left: 900, top: 400, width: 1000, height: 800 };
        if (!windows.has(id)) throw Error('window closed');
        return windows.get(id);
      },
      async getLastFocused() { return { id: 42, left: 100, top: 80, width: 1200, height: 900 }; },
      async update(id, options) { if (!windows.has(id)) throw Error('window closed'); if (options.focused) optionsFocused++; return windows.get(id); }
    },
    storage: {
      local: { ...(supportsAccessLevel ? { async setAccessLevel() {} } : {}), async get() { return local; }, async set(value) {
        if (failResultWrite && Object.hasOwn(value, 'analysisResults')) throw new Error('存储写入失败');
        Object.assign(local, value);
      } },
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
  const context = { chrome, fetch, URL, AbortController, TextDecoder, Date: clock,
    console: { error(error) { loggedErrors.push(error); } },
    setTimeout: timers?.setTimeout || (timeout ? callback => { queueMicrotask(callback); return 1; } : setTimeout),
    clearTimeout: timers?.clearTimeout || (timeout ? () => {} : clearTimeout) };
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
      return { events, done, send: message => onMessage(message), disconnect: () => port.disconnect() };
    },
    async openOptions(from = { ...sender, tab: { windowId: 42 } }) {
      return new Promise(resolve => { assert.equal(messageListener({ type: 'OPEN_OPTIONS' }, from, resolve), true); });
    },
    async getCached(from = sender) {
      return new Promise(resolve => { assert.equal(messageListener({ type: 'GET_CACHED_RESULT' }, from, resolve), true); });
    },
    async testConnection(settings, from = { id: 'test', url: 'chrome-extension://test/src/options.html' }) {
      return new Promise(resolve => { assert.equal(messageListener({ type: 'TEST_CONNECTION', settings }, from, resolve), true); });
    },
    async clickAction(tab) { actionClicked(tab); await new Promise(resolve => setImmediate(resolve)); },
    closeOptions() { windows.delete(session.settingsWindowId); },
    get requests() { return requests; },
    get permissionRequest() { return permissionRequest; },
    get optionsOpened() { return optionsOpened; },
    get optionsFocused() { return optionsFocused; },
    get popupOptions() { return popupOptions; },
    get local() { return local; },
    get loggedErrors() { return loggedErrors; }
  };
}

test('不支持存储访问级别 API 时仍可分析并恢复缓存', async () => {
  const app = setup({ supportsAccessLevel: false });
  assert.equal((await app.open().done).type, 'DONE');
  assert.equal((await app.getCached()).answer, '分析结果');
  assert.equal(app.requests.length, 1);
});

test('提交页齿轮与工具栏共用设置弹窗，重复打开时聚焦，关闭后可重建', async () => {
  const app = setup();
  assert.equal((await app.openOptions()).ok, true);
  assert.equal(app.optionsOpened, 1);
  assert.equal(app.popupOptions.url, 'chrome-extension://test/src/options.html');
  assert.equal(app.popupOptions.type, 'popup');
  assert.equal(app.popupOptions.width, 760);
  assert.equal(app.popupOptions.height, 680);
  assert.equal(app.popupOptions.left, 320);
  assert.equal(app.popupOptions.top, 190);
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

test('从非当前焦点窗口打开设置时按入口窗口居中', async () => {
  const from = { ...sender, tab: { windowId: 43 } };
  const page = setup();
  assert.equal((await page.openOptions(from)).ok, true);
  assert.equal(page.popupOptions.left, 1020);
  assert.equal(page.popupOptions.top, 460);

  const toolbar = setup();
  await toolbar.clickAction({ windowId: 43 });
  assert.equal(toolbar.popupOptions.left, 1020);
  assert.equal(toolbar.popupOptions.top, 460);
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
  assert.equal('reasoning_effort' in body, false);
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

test('图片题以多模态内容发送，流式回退保留全部图片', async () => {
  const images = ['data:image/png;base64,iVBORw0KGgo=', 'data:image/jpeg;base64,/9j/'];
  const app = setup({ respond: (_, __, count) => count === 1
    ? jsonResponse({ error: { message: 'stream is unsupported' } }, 400)
    : jsonResponse({ choices: [{ message: { content: '分析结果' } }] }) });
  assert.equal((await app.open({ type: 'ANALYZE', prompt: '题面：[题图 1][题图 2]', images }).done).type, 'DONE');
  assert.equal(app.requests.length, 2);
  for (const request of app.requests) {
    const content = JSON.parse(request.options.body).messages[1].content;
    assert.deepEqual(content, [
      { type: 'text', text: '题面：[题图 1][题图 2]' },
      { type: 'text', text: '题图 1：' }, { type: 'image_url', image_url: { url: images[0] } },
      { type: 'text', text: '题图 2：' }, { type: 'image_url', image_url: { url: images[1] } }
    ]);
  }
});

test('图片数据无效及模型不支持图片时显示错误且不缓存', async () => {
  const invalid = setup();
  const run = invalid.open({ type: 'ANALYZE', prompt: '题面', images: ['https://example.com/a.png'] });
  assert.equal((await run.done).type, 'ERROR');
  assert.equal(invalid.requests.length, 0);

  const unsupported = setup({ respond: () => jsonResponse({ error: { message: 'model does not support image input' } }, 400) });
  const rejected = unsupported.open({ type: 'ANALYZE', prompt: '题面', images: ['data:image/png;base64,iVBORw0KGgo='] });
  assert.equal((await rejected.done).type, 'ERROR');
  assert.match(rejected.events.at(-1).error, /model does not support image input/);
  assert.equal((await unsupported.getCached()).answer, null);
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
  assert.equal('reasoning_effort' in JSON.parse(fallback.requests[0].options.body), false);
  assert.equal('reasoning_effort' in JSON.parse(fallback.requests[1].options.body), false);
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

test('HTTP 错误展示限长说明并隐藏 API Key', async () => {
  const app = setup({ respond: () => jsonResponse({ error: { message: '不支持 reasoning_effort 参数；Bearer test-secret ' + 'x'.repeat(400) } }, 400) });
  const result = await app.open().done;
  assert.equal(result.type, 'ERROR');
  assert.match(result.error, /不支持 reasoning_effort/);
  assert.doesNotMatch(result.error, /test-secret/);
  assert.ok(result.error.length < 270);
});

test('测试连接使用设置页草稿且不写入设置或缓存', async () => {
  const app = setup({ respond: () => jsonResponse({ choices: [{ message: { content: '连接正常' } }] }) });
  const settings = { baseUrl: 'https://draft.example/v1', apiKey: 'draft-secret', model: 'draft-model', reasoningEffort: '' };
  assert.equal((await app.testConnection(settings)).ok, true);
  assert.equal(app.requests[0].url, 'https://draft.example/v1/chat/completions');
  const body = JSON.parse(app.requests[0].options.body);
  assert.equal(body.model, 'draft-model');
  assert.equal(body.stream, false);
  assert.equal('reasoning_effort' in body, false);
  assert.equal(app.local.model, 'custom-model');
  assert.equal(app.local.analysisResults, undefined);
  assert.equal((await app.testConnection(settings, sender)).ok, false);
});

test('非流式和流式长度截断均报错且不缓存', async () => {
  const nonstream = setup({ respond: () => jsonResponse({ choices: [{ message: { content: '部分回答' }, finish_reason: 'length' }] }) });
  const first = nonstream.open();
  assert.match((await first.done).error, /长度上限/);
  assert.equal((await nonstream.getCached()).answer, null);
  const stream = setup({ respond: () => sseResponse(new ReadableStream({ start(controller) {
    controller.enqueue(bytes('data: {"choices":[{"delta":{"content":"部分回答"}}]}\n\n'));
    controller.enqueue(bytes('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'));
    controller.enqueue(bytes('data: [DONE]\n\n'));
    controller.close();
  } })) });
  const second = stream.open();
  assert.match((await second.done).error, /长度上限/);
  assert.equal(second.events[0].text, '部分回答');
  assert.equal(second.events.some(event => event.type === 'DONE'), false);
  assert.equal((await stream.getCached()).answer, null);
});

test('后台允许直连和 WebVPN 通用提交页，拒绝伪造路径', async () => {
  for (const url of ['https://oj.neu.edu.cn/submissions/1716650',
    'https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/submissions/1716650',
    'https://oj.neu.edu.cn/contest/42/submission/1716680',
    'https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/contest/42/submission/1716680']) {
    const app = setup();
    assert.equal((await app.open(undefined, { url }).done).type, 'DONE');
    assert.equal(app.requests.length, 1);
  }
  for (const url of ['https://evil.example/contest/42/submission/1716680',
    'https://webvpn.neu.edu.cn/submissions/1716650',
    'https://webvpn.neu.edu.cn/https/other-id/contest/42/submission/1716680',
    'https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/submissions/not-a-number']) {
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
  assert.equal((await app.getCached()).answer, null);
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
  assert.match((await stalled.open().done).error, /连续 45 秒/);
  assert.equal(stalled.requests.length, 1);
});

test('自定义系统提示词用于请求，空白自定义提示词被拒绝', async () => {
  const app = setup({ customPrompt: '自定义定位规则' });
  assert.equal((await app.open().done).type, 'DONE');
  const body = JSON.parse(app.requests[0].options.body);
  assert.equal(body.messages[0].content, '自定义定位规则');
  const invalid = setup({ customPrompt: '  ' });
  assert.match((await invalid.open().done).error, /系统提示词无效/);
  assert.equal(invalid.requests.length, 0);
});

test('完成后按提交地址缓存，忽略锚点并隔离直连、WebVPN 和不同提交', async () => {
  const app = setup();
  const vpn = { url: sender.url + '#tabs-testcase-judging' };
  assert.equal((await app.getCached(vpn)).answer, null);
  assert.equal((await app.open(undefined, vpn).done).type, 'DONE');
  assert.equal((await app.getCached({ url: sender.url + '?tab=1' })).answer, '分析结果');
  assert.equal((await app.getCached({ url: sender.url.replace('62304135386136393339346365373340bfebea318fd008d8f60d257088', 'rotated-id') })).ok, false);
  assert.equal((await app.getCached({ url: 'https://oj.neu.edu.cn/training/8/submission/1716135' })).answer, null);
  assert.equal((await app.getCached({ url: sender.url.replace('1716135', '1716136') })).answer, null);
  assert.equal((await app.getCached({ url: 'https://evil.example/submissions/1' })).ok, false);
});

test('刷新重建后台后仍从共享本机存储读取缓存，并兼容旧 WebVPN 地址键', async () => {
  const localStore = { baseUrl: 'http://localhost:8765/v1', apiKey: 'test-secret', model: 'custom-model' };
  const first = setup({ localStore });
  assert.equal((await first.open().done).type, 'DONE');
  assert.equal(localStore.analysisResults[0].url, 'webvpn:/training/8/submission/1716135');
  const reloaded = setup({ localStore });
  assert.equal((await reloaded.getCached({ url: sender.url })).answer, '分析结果');
  assert.equal(reloaded.requests.length, 0);

  localStore.analysisResults = [{ url: sender.url, answer: '旧版结果' }];
  assert.equal((await reloaded.getCached({ url: sender.url })).answer, '旧版结果');
  assert.equal((await reloaded.open().done).type, 'DONE');
  assert.equal(localStore.analysisResults.length, 1);
  assert.equal(localStore.analysisResults[0].url, 'webvpn:/training/8/submission/1716135');
});

test('缓存写入失败时保留已生成文字并报告错误，不发送完成事件', async () => {
  const app = setup({ failResultWrite: true });
  const run = app.open();
  assert.equal((await run.done).type, 'ERROR');
  assert.ok(run.events.some(event => event.type === 'DELTA' && event.text === '分析结果'));
  assert.equal(run.events.some(event => event.type === 'DONE'), false);
  assert.match(run.events.at(-1).error, /缓存保存失败/);
  assert.equal((await app.getCached()).answer, null);
  assert.equal(app.loggedErrors.length, 1);
});

test('失败分析保留旧缓存，新成功结果覆盖，并只保留最近十个提交', async () => {
  let fail = false;
  let answer = '第一次';
  const app = setup({ respond: () => fail ? jsonResponse({ error: 'failed' }, 401)
    : jsonResponse({ choices: [{ message: { content: answer } }] }) });
  assert.equal((await app.open().done).type, 'DONE');
  fail = true;
  assert.equal((await app.open().done).type, 'ERROR');
  assert.equal((await app.getCached()).answer, '第一次');
  fail = false;
  answer = '第二次';
  assert.equal((await app.open().done).type, 'DONE');
  assert.equal((await app.getCached()).answer, '第二次');
  for (let id = 1; id <= 10; id++) {
    assert.equal((await app.open(undefined, { url: `https://oj.neu.edu.cn/submissions/${id}` }).done).type, 'DONE');
  }
  assert.equal(app.local.analysisResults.length, 10);
  assert.equal((await app.getCached()).answer, null);
});


test('思考字符与准确 token 进度独立于回答和缓存', async () => {
  const payloads = [
    { choices: [{ delta: { reasoning_content: '想😀' } }] },
    { choices: [{ delta: { reasoning: '继续' } }] },
    { choices: [], usage: { completion_tokens: 99 } },
    { choices: [], usage: { completion_tokens_details: { reasoning_tokens: 12 } } },
    { choices: [{ delta: { reasoning_content: '隐藏', content: '结论' } }] },
    { choices: [{ delta: { reasoning: '后续' } }] }
  ];
  const app = setup({ respond: () => sseResponse(new ReadableStream({ start(controller) {
    for (const payload of payloads) controller.enqueue(bytes(`data: ${JSON.stringify(payload)}\n\n`));
    controller.enqueue(bytes('data: [DONE]\n\n'));
    controller.close();
  } })) });
  const run = app.open();
  assert.equal((await run.done).type, 'DONE');
  assert.deepEqual(JSON.parse(JSON.stringify(run.events)).map(({ startedAt, durationMs, ...event }) => event), [
    { type: 'THINKING', count: 2, unit: 'characters' },
    { type: 'THINKING', count: 4, unit: 'characters' },
    { type: 'THINKING', count: 12, unit: 'tokens' },
    { type: 'THINKING_SUMMARY', count: 12, unit: 'tokens' },
    { type: 'DELTA', text: '结论' }, { type: 'DONE' }
  ]);
  assert.equal((await app.getCached()).answer, '结论');
});

test('空思考字段只通知思考状态，无效 token 用量不当作准确计数', async () => {
  const app = setup({ respond: () => sseResponse(new ReadableStream({ start(controller) {
    controller.enqueue(bytes('data: {"choices":[{"delta":{"reasoning":""}}],"usage":{"completion_tokens_details":{"reasoning_tokens":-1}}}\n\n'));
    controller.enqueue(bytes('data: {"choices":[{"delta":{"content":"回答"}}]}\n\ndata: [DONE]\n\n'));
    controller.close();
  } })) });
  const run = app.open();
  assert.equal((await run.done).type, 'DONE');
  assert.equal(run.events[0].type, 'THINKING');
  assert.equal(run.events[0].count, null);
});

function controlledTimers() {
  let now = 0;
  let nextId = 0;
  const pending = new Map();
  return {
    setTimeout(callback, delay) { const id = ++nextId; pending.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { pending.delete(id); },
    advance(delay) {
      now += delay;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) { pending.delete(id); timer.callback(); }
      }
    }
  };
}

test('持续思考与心跳超过 120 秒仍完成，静默 45 秒才取消且 PING 不延长', async () => {
  for (const finish of [true, false]) {
    const timers = controlledTimers();
    let streamController;
    const app = setup({ timers, respond: (_, options) => sseResponse(new ReadableStream({ start(controller) {
      streamController = controller;
      options.signal.addEventListener('abort', () => controller.error({ name: 'AbortError' }));
    } })) });
    const run = app.open();
    await new Promise(resolve => setImmediate(resolve));
    for (let i = 0; i < 4; i++) {
      timers.advance(40000);
      streamController.enqueue(bytes(i % 2 ? ': heartbeat\n\n' : 'data: {"choices":[{"delta":{"reasoning":"想"}}]}\n\n'));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(run.events.some(event => event.type === 'ERROR'), false);
    }
    if (finish) {
      streamController.enqueue(bytes('data: {"choices":[{"delta":{"content":"回答"}}]}\n\ndata: [DONE]\n\n'));
      streamController.close();
      assert.equal((await run.done).type, 'DONE');
    } else {
      timers.advance(44000);
      run.send({ type: 'PING' });
      streamController.enqueue(new Uint8Array());
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(run.events.some(event => event.type === 'ERROR'), false);
      timers.advance(1000);
      assert.equal((await run.done).error, '模型接口连续 45 秒未返回新数据，请重试。');
    }
  }
});

test('非流式 JSON 持续接收数据时刷新空闲计时', async () => {
  const timers = controlledTimers();
  let streamController;
  const app = setup({ timers, respond: (_, options) => new Response(new ReadableStream({ start(controller) {
    streamController = controller;
    options.signal.addEventListener('abort', () => controller.error({ name: 'AbortError' }));
  } }), { headers: { 'content-type': 'application/json' } }) });
  const run = app.open();
  await new Promise(resolve => setImmediate(resolve));
  for (const part of ['{"choices":', '[{"message":', '{"content":', '"分析"}}]}']) {
    timers.advance(40000);
    streamController.enqueue(bytes(part));
    await new Promise(resolve => setImmediate(resolve));
  }
  streamController.close();
  assert.equal((await run.done).type, 'DONE');
});

test('等待响应头连续静默 45 秒会取消请求', async () => {
  const timers = controlledTimers();
  const app = setup({ timers, respond: (_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject({ name: 'AbortError' }));
  }) });
  const run = app.open();
  await new Promise(resolve => setImmediate(resolve));
  timers.advance(44999);
  assert.equal(run.events.length, 0);
  timers.advance(1);
  assert.equal((await run.done).error, '模型接口连续 45 秒未返回新数据，请重试。');
});


test('思考汇总固定耗时，晚到 token 用量只更新计数，同事件思考回答计时为零', async () => {
  let now = 1000;
  let controller;
  const app = setup({ clock: { now: () => now }, respond: () => sseResponse(new ReadableStream({ start(value) { controller = value; } })) });
  const run = app.open();
  const send = async payload => {
    controller.enqueue(bytes(`data: ${JSON.stringify(payload)}\n\n`));
    await new Promise(resolve => setImmediate(resolve));
  };
  await new Promise(resolve => setImmediate(resolve));
  await send({ choices: [{ delta: { reasoning: '想' } }] });
  assert.equal(run.events[0].startedAt, 1000);
  now = 19500;
  await send({ choices: [{ delta: { content: '结论' } }] });
  const summary = run.events.find(event => event.type === 'THINKING_SUMMARY');
  assert.equal(summary.durationMs, 18500);
  now = 50000;
  await send({ usage: { completion_tokens_details: { reasoning_tokens: 128 } } });
  assert.equal(run.events.at(-1).count, 128);
  assert.equal(run.events.at(-1).durationMs, 18500);
  controller.enqueue(bytes('data: [DONE]\n\n'));
  controller.close();
  assert.equal((await run.done).type, 'DONE');
  const instant = setup({ clock: { now: () => 42 }, respond: () => sseResponse(new ReadableStream({ start(value) {
    value.enqueue(bytes('data: {"choices":[{"delta":{"reasoning":"想","content":"答"}}]}\n\ndata: [DONE]\n\n'));
    value.close();
  } })) });
  const second = instant.open();
  await second.done;
  assert.equal(second.events[0].type, 'THINKING_SUMMARY');
  assert.equal(second.events[0].durationMs, 0);
});
