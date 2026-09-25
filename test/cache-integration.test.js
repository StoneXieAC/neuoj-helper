const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const markdownit = require('markdown-it');
const katex = require('katex');
const texmath = require('markdown-it-texmath');
const core = require('../extension/src/core.js');

const backgroundScript = fs.readFileSync(path.join(__dirname, '../extension/src/background.js'), 'utf8');
const contentScript = fs.readFileSync(path.join(__dirname, '../extension/src/content.js'), 'utf8');
const pageUrl = 'https://webvpn.neu.edu.cn/https/62304135386136393339346365373340bfebea318fd008d8f60d257088/submissions/1716622';

function startBackground(local) {
  let onMessage;
  let onConnect;
  const chrome = {
    runtime: {
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener(fn) { onMessage = fn; } },
      onConnect: { addListener(fn) { onConnect = fn; } },
      getURL(name) { return `chrome-extension://test/${name}`; }
    },
    action: { onClicked: { addListener() {} } },
    storage: {
      local: { async setAccessLevel() {}, async get() { return local; }, async set(value) { Object.assign(local, value); } },
      session: { async get() { return {}; } }
    },
    permissions: { async contains() { return true; } }
  };
  const fetch = async url => url.startsWith('chrome-extension:')
    ? new Response('系统提示词')
    : new Response(JSON.stringify({ choices: [{ message: { content: '**缓存结论** $x^2$' } }] }),
      { headers: { 'content-type': 'application/json' } });
  vm.runInNewContext(backgroundScript, { chrome, fetch, URL, AbortController, TextDecoder,
    setTimeout, clearTimeout, console });
  return {
    getCached(url, callback) { onMessage({ type: 'GET_CACHED_RESULT' }, { url }, callback); },
    analyze(url) {
      let handleMessage;
      let handleDisconnect;
      return new Promise(resolve => {
        const port = {
          name: 'NEUOJ_ANALYZE', sender: { url },
          onMessage: { addListener(fn) { handleMessage = fn; } },
          onDisconnect: { addListener(fn) { handleDisconnect = fn; } },
          postMessage(event) { if (event.type === 'DONE' || event.type === 'ERROR') resolve(event); },
          disconnect() { handleDisconnect(); }
        };
        onConnect(port);
        handleMessage({ type: 'ANALYZE', prompt: '提交状态：WA' });
      });
    }
  };
}

function openPage(background, url) {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="tabs-source-code"><button data-clipboard-text="int main(){}"></button></div>
    <div id="tabs-compile-info"><div class="card-header">编译成功</div></div>
    <div id="tabs-testcase-judging"><div class="card"><div class="card-body"><div>#001 答案错误</div>
    <div id="show_output_system0"><div class="modal-body">exitcode: 0</div></div>
    <div id="show_output_diff0"><div class="modal-body">Judge: 1<br>Team: 2</div></div>
    <div id="show_output_error0"><div class="modal-body"></div></div>
    </div></div></div></body>`, { url });
  let cacheRequests = 0;
  let modelRequests = 0;
  const chrome = { runtime: {
    lastError: null,
    getURL(file) { return `chrome-extension://test/${file}`; },
    sendMessage(message, callback) {
      if (message.type !== 'GET_CACHED_RESULT') throw new Error('意外消息');
      cacheRequests++;
      background.getCached(url, callback);
    },
    connect() { modelRequests++; throw new Error('不应自动分析'); }
  } };
  vm.runInNewContext(contentScript, {
    globalThis: { NEUOJCore: core, markdownit, katex, texmath }, location: dom.window.location,
    document: dom.window.document, chrome, MutationObserver: dom.window.MutationObserver,
    DOMParser: dom.window.DOMParser, URL, setTimeout, setInterval, clearInterval,
    requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout,
    fetch() { throw new Error('不应自动获取题面'); }
  });
  return {
    document: dom.window.document,
    get cacheRequests() { return cacheRequests; },
    get modelRequests() { return modelRequests; }
  };
}

test('WebVPN 成功分析后重建后台和页面仍恢复本机缓存', async () => {
  const local = { baseUrl: 'http://localhost:8765/v1', apiKey: 'test-secret', model: 'custom-model' };
  const firstBackground = startBackground(local);
  assert.equal((await firstBackground.analyze(pageUrl)).type, 'DONE');
  assert.equal(local.analysisResults[0].answer, '**缓存结论** $x^2$');

  const reloadedBackground = startBackground(local);
  const reloadedPage = openPage(reloadedBackground, `${pageUrl}#tabs-testcase-judging`);
  await new Promise(resolve => setImmediate(resolve));
  const shadow = reloadedPage.document.getElementById('neuoj-helper-root').shadowRoot;
  assert.equal(shadow.querySelector('.result strong').textContent, '缓存结论');
  assert.equal(shadow.querySelector('.result .katex-mathml annotation').textContent, 'x^2');
  assert.equal(shadow.querySelector('.status').textContent, '已恢复上次分析');
  assert.equal(reloadedPage.cacheRequests, 1);
  assert.equal(reloadedPage.modelRequests, 0);
});
