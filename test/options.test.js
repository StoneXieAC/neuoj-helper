const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../extension/src/options.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../extension/src/options.js'), 'utf8');
const defaultPrompt = fs.readFileSync(path.join(__dirname, '../extension/prompts/system.md'), 'utf8').trim();

async function setup(granted = true, stored = {}, saveFails = false) {
  const dom = new JSDOM(html, { url: 'chrome-extension://example/src/options.html' });
  let requested;
  let saved;
  let closed = false;
  const chrome = {
    runtime: { getURL(name) { return `chrome-extension://example/${name}`; } },
    permissions: { async request(value) { requested = value; return granted; } },
    storage: { local: { async get() { return stored; }, async setAccessLevel() {}, async set(value) {
      if (saveFails) throw new Error('磁盘不可用');
      saved = value;
    } } }
  };
  const fetch = async () => new Response(defaultPrompt);
  vm.runInNewContext(script, { document: dom.window.document, URL, chrome, fetch, window: { close() { closed = true; } } });
  await new Promise(resolve => setImmediate(resolve));
  return { document: dom.window.document, get requested() { return requested; }, get saved() { return saved; }, get closed() { return closed; } };
}

test('设置页使用默认 DeepSeek 配置并按域名申请权限', async () => {
  const app = await setup();
  assert.equal(app.document.getElementById('baseUrl').value, 'https://api.deepseek.com');
  assert.equal(app.document.getElementById('model').value, 'deepseek-flash');
  assert.equal(app.document.getElementById('reasoningEffort').value, 'low');
  app.document.getElementById('baseUrl').value = 'http://localhost:8765/v1/';
  app.document.getElementById('apiKey').value = 'secret';
  app.document.getElementById('model').value = 'another-model';
  app.document.getElementById('settings').dispatchEvent(new app.document.defaultView.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.requested.origins[0], 'http://localhost/*');
  assert.deepEqual(JSON.parse(JSON.stringify(app.saved)), { baseUrl: 'http://localhost:8765/v1', apiKey: 'secret', model: 'another-model', reasoningEffort: 'low', systemPrompt: null });
  assert.equal(app.closed, true);
});

test('思考等级可自由填写，清空后仍能保存为空值', async () => {
  const app = await setup(true, { reasoningEffort: 'max' });
  const field = app.document.getElementById('reasoningEffort');
  assert.equal(field.value, 'max');
  app.document.getElementById('apiKey').value = 'secret';
  field.value = '  minimal  ';
  app.document.getElementById('settings').dispatchEvent(new app.document.defaultView.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.saved.reasoningEffort, 'minimal');
  field.value = '  ';
  app.document.getElementById('settings').dispatchEvent(new app.document.defaultView.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.saved.reasoningEffort, '');
});

test('拒绝接口权限时不会保存设置', async () => {
  const app = await setup(false);
  app.document.getElementById('apiKey').value = 'secret';
  app.document.getElementById('settings').dispatchEvent(new app.document.defaultView.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.saved, undefined);
  assert.match(app.document.getElementById('message').textContent, /未获得接口域名权限/);
  assert.equal(app.closed, false);
});

test('侧边栏按配置切换，键盘可切换分类', async () => {
  const app = await setup();
  const doc = app.document;
  const tabs = [...doc.querySelectorAll('#categories [role="tab"]')];
  assert.deepEqual(tabs.map(tab => tab.textContent), ['API 设置', '提示词设置']);
  assert.equal(doc.getElementById('prompt-panel').hidden, true);
  tabs[0].dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(doc.getElementById('api-panel').hidden, true);
  assert.equal(doc.getElementById('prompt-panel').hidden, false);
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  tabs[0].click();
  assert.equal(doc.getElementById('api-panel').hidden, false);
});

test('自定义提示词加载与恢复默认均通过统一保存生效', async () => {
  const app = await setup(true, { apiKey: 'secret', systemPrompt: '用户自定义' });
  const doc = app.document;
  const prompt = doc.getElementById('systemPrompt');
  assert.equal(prompt.value, '用户自定义');
  doc.getElementById('prompt-tab').click();
  doc.getElementById('restoreDefault').click();
  assert.equal(prompt.value, defaultPrompt);
  assert.equal(app.saved, undefined);
  assert.equal(app.closed, false);
  doc.getElementById('settings').dispatchEvent(new doc.defaultView.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.saved.systemPrompt, null);
  assert.equal(app.closed, true);
  const custom = await setup(true, { apiKey: 'secret' });
  custom.document.getElementById('systemPrompt').value = '新规则';
  custom.document.getElementById('settings').dispatchEvent(new custom.document.defaultView.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(custom.saved.systemPrompt, '新规则');
});

test('提示词无效或存储失败时不关闭窗口', async () => {
  const app = await setup(true, { apiKey: 'secret' });
  const doc = app.document;
  doc.getElementById('systemPrompt').value = ' ';
  doc.getElementById('settings').dispatchEvent(new doc.defaultView.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(doc.getElementById('prompt-panel').hidden, false);
  assert.match(doc.getElementById('message').textContent, /提示词不能为空/);
  assert.equal(app.closed, false);
  const failing = await setup(true, { apiKey: 'secret' }, true);
  failing.document.getElementById('settings').dispatchEvent(new failing.document.defaultView.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(failing.document.getElementById('message').textContent, /磁盘不可用/);
  assert.equal(failing.closed, false);
});
