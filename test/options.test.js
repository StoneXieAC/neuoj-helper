const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../extension/src/options.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../extension/src/options.js'), 'utf8');

async function setup(granted = true, stored = {}) {
  const dom = new JSDOM(html, { url: 'chrome-extension://example/src/options.html' });
  let requested;
  let saved;
  const chrome = {
    permissions: { async request(value) { requested = value; return granted; } },
    storage: { local: { async get() { return stored; }, async setAccessLevel() {}, async set(value) { saved = value; } } }
  };
  vm.runInNewContext(script, { document: dom.window.document, URL, chrome });
  await Promise.resolve();
  return { document: dom.window.document, get requested() { return requested; }, get saved() { return saved; } };
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
  assert.deepEqual(JSON.parse(JSON.stringify(app.saved)), { baseUrl: 'http://localhost:8765/v1', apiKey: 'secret', model: 'another-model', reasoningEffort: 'low' });
  assert.match(app.document.getElementById('message').textContent, /设置已保存/);
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
});
