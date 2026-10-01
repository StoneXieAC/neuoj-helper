const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({ firefox = true, native = false, consent } = {}) {
  const local = { dataTransmissionConsent: consent };
  const session = {};
  const timers = new Map();
  const requests = [];
  let timerId = 0;
  let calls = 0;
  let changed;
  const chrome = {
    runtime: {
      id: 'compatibility', getManifest: () => firefox ? { browser_specific_settings: { gecko: {} } } : {},
      getURL: file => `extension://${file}`,
      getPlatformInfo(callback) { calls++; callback({}); },
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener() {} }, onConnect: { addListener() {} }
    },
    action: { onClicked: { addListener() {} } },
    permissions: { async getAll() { return native ? { data_collection: [] } : {}; } },
    storage: {
      local: { async get() { return local; }, async set(value) { Object.assign(local, value); } },
      session: { async get(key) { return { [key]: session[key] }; } },
      onChanged: { addListener(fn) { changed = fn; } }
    }
  };
  const context = vm.createContext({ chrome, URL, AbortController, TextDecoder, console,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: async (url, options) => { requests.push({ url, options }); throw new Error('不应发出请求'); }
  });
  vm.runInContext(fs.readFileSync('extension/src/background.js', 'utf8'), context);
  return { context, local, session, timers, requests, get calls() { return calls; }, revoke() {
    local.dataTransmissionConsent = { version: 1, granted: false };
    changed({ dataTransmissionConsent: { newValue: local.dataTransmissionConsent } }, 'local');
  } };
}

test('旧版 Firefox 拒绝缺失、失效或撤回的授权，接受当前版本授权', async () => {
  for (const consent of [undefined, { version: 0, granted: true }, { version: 1, granted: false }]) {
    await assert.rejects(setup({ consent }).context.requireDataConsent(), /同意数据发送/);
  }
  const app = setup({ consent: { version: 1, granted: true } });
  await app.context.requireDataConsent();
  app.revoke();
  await assert.rejects(app.context.requireDataConsent(), /同意数据发送/);
});

test('新版 Firefox 和 Chrome 不要求旧版授权记录', async () => {
  await setup({ native: true }).context.requireDataConsent();
  await setup({ firefox: false }).context.requireDataConsent();
});

test('未授权时分析、测试连接和 IDE 收发不发出网络请求', async () => {
  const app = setup();
  const ctx = app.context;
  await assert.rejects(ctx.analyze('测试', [], { url: 'https://oj.neu.edu.cn/submissions/123' }, () => {}, () => {}, new AbortController(), () => {}), /同意数据发送/);
  await assert.rejects(ctx.testConnection({}, { id: 'compatibility', url: 'extension://src/options.html' }), /同意数据发送/);
  await assert.rejects(ctx.importToIde({}, {}), /同意数据发送/);
  await assert.rejects(ctx.bridgeCapabilities(39271), /同意数据发送/);
  await assert.rejects(ctx.pollBridge({}, ''), /同意数据发送/);
  await assert.rejects(ctx.postBridgeResult({}, '', {}), /同意数据发送/);
  assert.equal(app.requests.length, 0);
});

test('后台保活每 20 秒调用扩展 API，完成和取消均清理计时器', () => {
  const app = setup({ firefox: false });
  const controller = new AbortController();
  const stop = app.context.keepBackgroundActive(controller.signal);
  assert.equal(app.timers.size, 1);
  const [id, timer] = [...app.timers][0];
  assert.equal(timer.delay, 20000);
  app.timers.delete(id);
  timer.fn();
  assert.equal(app.calls, 1);
  assert.equal(app.timers.size, 1);
  stop();
  assert.equal(app.timers.size, 0);
  app.context.keepBackgroundActive(controller.signal);
  controller.abort();
  assert.equal(app.timers.size, 0);
  app.context.keepBackgroundActive(controller.signal);
  assert.equal(app.timers.size, 0);
});

test('授权撤回会取消已登记请求', () => {
  const app = setup({ consent: { version: 1, granted: true } });
  const controller = new AbortController();
  app.context.controller = controller;
  vm.runInContext('activeRequests.add(controller)', app.context);
  app.revoke();
  assert.equal(controller.signal.aborted, true);
});

test('IDE 后台没有配对任务时不启动保活计时器', async () => {
  const app = setup({ firefox: false });
  await app.context.startBridge();
  assert.equal(app.timers.size, 0);
  assert.equal(app.calls, 0);
});


test('IDE 实例变化退出后台循环时清理保活计时器', async () => {
  const app = setup({ firefox: false });
  app.session.ideBridgeToken = 'a'.repeat(64);
  app.session.ideBridgeEndpoint = { port: 39271, instanceId: '11111111-1111-4111-8111-111111111111' };
  app.context.fetch = async () => new Response(JSON.stringify({ service: 'neuoj-ide-bridge', protocolVersion: 1,
    ide: 'CLion', capabilities: ['importProblem', 'submitCode'], instanceId: '22222222-2222-4222-8222-222222222222' }));
  await app.context.startBridge();
  assert.equal(app.timers.size, 0);
});
