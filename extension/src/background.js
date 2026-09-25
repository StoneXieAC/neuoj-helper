'use strict';

const DEFAULTS = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' };
const MAX_ANSWER = 200000;
const SETTINGS_WINDOW_KEY = 'settingsWindowId';
const RESULTS_KEY = 'analysisResults';
const MAX_RESULTS = 10;
let systemPromptPromise;
let optionsOpening;
let cacheWrite = Promise.resolve();

function allowedBaseUrl(value) {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    const path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    return `${url.origin}${path}`;
  } catch { return null; }
}

function validateSender(sender) {
  let url;
  try { url = new URL(sender?.url); } catch { url = null; }
  let path = url?.pathname || '';
  if (url?.hostname === 'webvpn.neu.edu.cn') {
    const prefix = path.match(/^\/(?:https|http)\/[^/]+(?=\/)/)?.[0];
    path = prefix ? path.slice(prefix.length) : '';
  }
  if (!url || !['oj.neu.edu.cn', 'webvpn.neu.edu.cn'].includes(url.hostname) ||
    url.protocol !== 'https:' || !/^(?:\/training\/\d+\/submission|\/submissions)\/\d+\/?$/.test(path)) {
    throw new Error('只能从 NEUOJ 提交详情页使用插件。');
  }
}

async function restrictStorage() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}

function submissionKey(raw) {
  validateSender({ url: raw });
  const url = new URL(raw);
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}

async function cachedResult(raw) {
  const key = submissionKey(raw);
  const saved = await chrome.storage.local.get(RESULTS_KEY);
  const entry = saved[RESULTS_KEY]?.find(item => item.url === key);
  return typeof entry?.answer === 'string' && entry.answer.trim() ? entry.answer : null;
}

function saveResult(raw, answer) {
  const key = submissionKey(raw);
  cacheWrite = cacheWrite.catch(() => {}).then(async () => {
    const saved = await chrome.storage.local.get(RESULTS_KEY);
    const entries = Array.isArray(saved[RESULTS_KEY]) ? saved[RESULTS_KEY] : [];
    await chrome.storage.local.set({ [RESULTS_KEY]: [{ url: key, answer },
      ...entries.filter(item => item.url !== key)].slice(0, MAX_RESULTS) });
  });
  return cacheWrite;
}

function openOptionsPopup(entryWindowId) {
  if (!optionsOpening) {
    optionsOpening = (async () => {
      const saved = await chrome.storage.session.get(SETTINGS_WINDOW_KEY);
      const settingsWindowId = saved[SETTINGS_WINDOW_KEY];
      if (Number.isInteger(settingsWindowId)) {
        try {
          await chrome.windows.get(settingsWindowId);
          await chrome.windows.update(settingsWindowId, { focused: true });
          return;
        } catch { await chrome.storage.session.remove(SETTINGS_WINDOW_KEY); }
      }
      const size = { width: 760, height: 680 };
      let parent;
      try { parent = Number.isInteger(entryWindowId) ? await chrome.windows.get(entryWindowId) : await chrome.windows.getLastFocused(); }
      catch { parent = null; }
      const position = Number.isFinite(parent?.left) && Number.isFinite(parent?.top) &&
        Number.isFinite(parent?.width) && Number.isFinite(parent?.height)
        ? { left: Math.round(parent.left + (parent.width - size.width) / 2),
          top: Math.round(parent.top + (parent.height - size.height) / 2) } : {};
      const popup = await chrome.windows.create({
        url: chrome.runtime.getURL('src/options.html'),
        type: 'popup', ...size, ...position, focused: true
      });
      if (!Number.isInteger(popup?.id)) throw new Error('无法打开接口设置窗口。');
      await chrome.storage.session.set({ [SETTINGS_WINDOW_KEY]: popup.id });
    })().finally(() => { optionsOpening = null; });
  }
  return optionsOpening;
}

function loadSystemPrompt() {
  if (!systemPromptPromise) {
    systemPromptPromise = (async () => {
      const response = await fetch(chrome.runtime.getURL('prompts/system.md'));
      if (!response.ok) throw new Error('无法读取系统提示词文件。');
      const prompt = (await response.text()).trim();
      if (!prompt) throw new Error('系统提示词文件为空。');
      return prompt;
    })().catch(error => { systemPromptPromise = null; throw error; });
  }
  return systemPromptPromise;
}

function timeoutFor(controller) {
  let timedOut = false;
  let idleTimer;
  const abort = () => { timedOut = true; controller.abort(); };
  const totalTimer = setTimeout(abort, 120000);
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(abort, 45000);
  };
  resetIdle();
  return { resetIdle, didTimeOut: () => timedOut, clear: () => { clearTimeout(idleTimer); clearTimeout(totalTimer); } };
}

function answerFromJson(payload) {
  const answer = payload?.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('模型接口没有返回可显示的分析内容。');
  if (answer.length > MAX_ANSWER) throw new Error('模型回复超过长度限制。');
  return answer;
}

async function errorDetail(response) {
  const text = (await response.text()).slice(0, 4000);
  try {
    const payload = JSON.parse(text);
    return String(payload?.error?.message || payload?.message || text);
  } catch { return text; }
}

function httpError(status) {
  if (status === 401 || status === 403) return new Error('接口鉴权失败，请检查 API Key 和访问权限。');
  if (status === 429) return new Error('接口请求过于频繁，请稍后重试。');
  return new Error(`模型接口返回 HTTP ${status}。`);
}

function rejectsStreaming(status, detail) {
  return [400, 422, 501].includes(status) && /stream|流式|流输出/i.test(detail) &&
    /unsupported|not support|unknown|invalid|disabled|不支持|不接受|无法|无效|禁用/i.test(detail);
}

async function consumeEvents(response, emit, resetIdle) {
  if (!response.body?.getReader) throw new Error('模型接口没有返回可读取的数据流。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let answer = '';
  let finished = false;

  function handleEvent(raw) {
    const data = raw.split(/\r\n|\r|\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') { finished = true; return; }
    let payload;
    try { payload = JSON.parse(data); }
    catch { throw new Error('模型接口返回了无效的流式数据。'); }
    if (payload?.error) throw new Error(`模型接口流式返回错误：${payload.error.message || '未知错误。'}`);
    const delta = payload?.choices?.[0]?.delta?.content;
    if (typeof delta !== 'string' || !delta) return;
    answer += delta;
    if (answer.length > MAX_ANSWER) throw new Error('模型回复超过长度限制。');
    emit(delta);
  }

  try {
    while (!finished) {
      const chunk = await reader.read();
      if (chunk.done) break;
      resetIdle();
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > 1000000) throw new Error('模型接口返回了过长的流式事件。');
      let delimiter;
      while ((delimiter = /\r\n\r\n|\n\n|\r\r/.exec(pending))) {
        const raw = pending.slice(0, delimiter.index);
        pending = pending.slice(delimiter.index + delimiter[0].length);
        handleEvent(raw);
        if (finished) break;
      }
    }
  } finally {
    if (finished) reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!finished) throw new Error('模型输出中途断开，请重试。');
  if (!answer.trim()) throw new Error('模型接口没有返回可显示的分析内容。');
  return answer;
}

async function analyze(prompt, sender, emit, controller, resetIdle) {
  validateSender(sender);
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 24000) {
    throw new Error('分析内容无效或超过长度限制。');
  }
  await restrictStorage();
  const settings = await chrome.storage.local.get(['baseUrl', 'apiKey', 'model', 'reasoningEffort', 'systemPrompt']);
  const baseUrl = allowedBaseUrl(settings.baseUrl || DEFAULTS.baseUrl);
  const apiKey = String(settings.apiKey || '').trim();
  const model = String(settings.model || DEFAULTS.model).trim();
  const reasoningEffort = String(settings.reasoningEffort ?? 'low').trim();
  if (!baseUrl || !model) throw new Error('接口设置无效，请打开插件设置检查。');
  if (!apiKey) throw new Error('请先在插件设置中填写 API Key。');
  const apiUrl = new URL(baseUrl);
  const origin = `${apiUrl.protocol}//${apiUrl.hostname}/*`;
  if (!await chrome.permissions.contains({ origins: [origin] })) {
    throw new Error('尚未授权访问模型接口，请在插件设置中保存并授权接口地址。');
  }
  const systemPrompt = settings.systemPrompt == null ? await loadSystemPrompt() : settings.systemPrompt;
  if (typeof systemPrompt !== 'string' || !systemPrompt.trim() || systemPrompt.length > 10000) {
    throw new Error('系统提示词无效，请在插件设置中检查。');
  }
  const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }];

  async function request(stream) {
    resetIdle();
    try {
      return await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, stream, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new Error('无法连接模型接口，请检查地址、网络和接口权限。');
    }
  }

  let response = await request(true);
  if (!response.ok) {
    const detail = await errorDetail(response);
    if (!rejectsStreaming(response.status, detail)) throw httpError(response.status);
    response = await request(false);
  }
  if (!response.ok) throw httpError(response.status);
  resetIdle();
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
    let payload;
    try { payload = await response.json(); }
    catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new Error('模型接口返回的不是有效 JSON。');
    }
    const answer = answerFromJson(payload);
    emit(answer);
    return answer;
  } else {
    return consumeEvents(response, emit, resetIdle);
  }
}

chrome.runtime.onInstalled.addListener(() => { restrictStorage().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { restrictStorage().catch(console.error); });
restrictStorage().catch(console.error);
chrome.action.onClicked.addListener(tab => { openOptionsPopup(tab?.windowId).catch(console.error); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['OPEN_OPTIONS', 'GET_CACHED_RESULT'].includes(message?.type)) return false;
  (async () => {
    validateSender(sender);
    if (message.type === 'OPEN_OPTIONS') {
      await openOptionsPopup(sender.tab?.windowId);
      return { ok: true };
    }
    return { ok: true, answer: await cachedResult(sender.url) };
  })().then(sendResponse, error => sendResponse({ ok: false, error: error.message || '操作失败。' }));
  return true;
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'NEUOJ_ANALYZE') return;
  let started = false;
  let disconnected = false;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => { disconnected = true; controller.abort(); });
  port.onMessage.addListener(message => {
    if (message?.type === 'PING') return;
    if (started || message?.type !== 'ANALYZE') return;
    started = true;
    const timeout = timeoutFor(controller);
    const post = event => {
      if (disconnected) return;
      try { port.postMessage(event); }
      catch { disconnected = true; controller.abort(); }
    };
    analyze(message.prompt, port.sender, text => post({ type: 'DELTA', text }), controller, timeout.resetIdle)
      .then(async answer => {
        if (!disconnected) {
          try { await saveResult(port.sender.url, answer); } catch (error) { console.error(error); }
          post({ type: 'DONE' });
        }
      }, error => {
        if (disconnected) return;
        const reason = timeout.didTimeOut() || error?.name === 'AbortError'
          ? '模型请求超时，请稍后重试。'
          : error?.message || '操作失败。';
        post({ type: 'ERROR', error: reason });
      }).finally(() => { timeout.clear(); if (!disconnected) port.disconnect(); });
  });
});
