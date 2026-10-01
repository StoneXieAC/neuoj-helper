'use strict';

const DEFAULTS = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' };
const MAX_ANSWER = 200000;
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;
const SETTINGS_WINDOW_KEY = 'settingsWindowId';
const RESULTS_KEY = 'analysisResults';
const MAX_RESULTS = 10;
const VPN_PREFIX = '/https/62304135386136393339346365373340bfebea318fd008d8f60d257088';
const BRIDGE_TOKEN_KEY = 'ideBridgeToken';
const BRIDGE_TABS_KEY = 'ideBridgeTabs';
const BRIDGE_ENDPOINT_KEY = 'ideBridgeEndpoint';
const BRIDGE_PORTS = Array.from({ length: 10 }, (_, index) => 39271 + index);
const BRIDGE_INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let systemPromptPromise;
let optionsOpening;
let cacheWrite = Promise.resolve();
let bridgeLoop;
let bridgeGeneration = 0;
let bridgePollController;

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
    path = path.startsWith(`${VPN_PREFIX}/`) ? path.slice(VPN_PREFIX.length) : '';
  }
  if (!url || !['oj.neu.edu.cn', 'webvpn.neu.edu.cn'].includes(url.hostname) ||
    url.protocol !== 'https:' || url.username || url.password ||
    !/(?:^|\/)submissions?\/\d+\/?$/.test(path)) {
    throw new Error('只能从 NEUOJ 提交详情页使用插件。');
  }
}

async function restrictStorage() {
  if (typeof chrome.storage.local.setAccessLevel === 'function') {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }
}

function submissionKey(raw) {
  validateSender({ url: raw });
  const url = new URL(raw);
  let path = url.pathname.replace(/\/$/, '');
  if (url.hostname === 'webvpn.neu.edu.cn') {
    path = path.slice(VPN_PREFIX.length);
    return `webvpn:${path}`;
  }
  return `${url.origin}${path}`;
}

async function cachedResult(raw) {
  const key = submissionKey(raw);
  const saved = await chrome.storage.local.get(RESULTS_KEY);
  const entries = Array.isArray(saved[RESULTS_KEY]) ? saved[RESULTS_KEY] : [];
  const entry = entries.find(item => cacheEntryKey(item) === key);
  return typeof entry?.answer === 'string' && entry.answer.trim() ? entry.answer : null;
}

function cacheEntryKey(item) {
  if (typeof item?.url !== 'string') return null;
  try { return item.url.startsWith('webvpn:') ? item.url : submissionKey(item.url); }
  catch { return null; }
}

function saveResult(raw, answer) {
  const key = submissionKey(raw);
  cacheWrite = cacheWrite.catch(() => {}).then(async () => {
    const saved = await chrome.storage.local.get(RESULTS_KEY);
    const entries = Array.isArray(saved[RESULTS_KEY]) ? saved[RESULTS_KEY] : [];
    await chrome.storage.local.set({ [RESULTS_KEY]: [{ url: key, answer },
      ...entries.filter(item => cacheEntryKey(item) !== key)].slice(0, MAX_RESULTS) });
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
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(abort, 45000);
  };
  resetIdle();
  return { resetIdle, didTimeOut: () => timedOut, clear: () => { clearTimeout(idleTimer); } };
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

function safeDetail(detail, apiKey = '') {
  let text = String(detail || '').replace(/<[^>]*>/g, ' ').replace(/[\r\n\t\x00-\x1f]+/g, ' ');
  if (apiKey) text = text.split(apiKey).join('[已隐藏]');
  return text.replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, '[已隐藏]')
    .replace(/\b(api[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1: [已隐藏]')
    .slice(0, 200).trim();
}

function httpError(status, detail = '', apiKey = '') {
  const prefix = status === 401 || status === 403 ? '接口鉴权失败，请检查 API Key 和访问权限。'
    : status === 429 ? '接口请求过于频繁，请稍后重试。' : `模型接口返回 HTTP ${status}。`;
  const safe = safeDetail(detail, apiKey);
  return new Error(safe ? `${prefix}服务端说明：${safe}` : prefix);
}

function rejectsStreaming(status, detail) {
  return [400, 422, 501].includes(status) && /stream|流式|流输出/i.test(detail) &&
    /unsupported|not support|unknown|invalid|disabled|不支持|不接受|无法|无效|禁用/i.test(detail);
}

async function consumeEvents(response, emit, emitThinking, resetIdle, apiKey) {
  if (!response.body?.getReader) throw new Error('模型接口没有返回可读取的数据流。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let answer = '';
  let finished = false;
  let thinkingCharacters = 0;
  let thinkingTokens = null;
  let answerStarted = false;
  let thinkingStartedAt = null;
  let thinkingDurationMs = null;

  function handleEvent(raw) {
    const data = raw.split(/\r\n|\r|\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') { finished = true; return; }
    let payload;
    try { payload = JSON.parse(data); }
    catch { throw new Error('模型接口返回了无效的流式数据。'); }
    if (payload?.error) throw new Error(`模型接口流式返回错误：${safeDetail(payload.error.message, apiKey) || '未知错误。'}`);
    if (payload?.choices?.[0]?.finish_reason === 'length') throw new Error('模型回答达到长度上限，请调整请求后重试。');
    const fields = payload?.choices?.[0]?.delta;
    const reasoning = typeof fields?.reasoning_content === 'string' ? fields.reasoning_content
      : typeof fields?.reasoning === 'string' ? fields.reasoning : null;
    const tokens = payload?.usage?.completion_tokens_details?.reasoning_tokens
      ?? payload?.usage?.output_tokens_details?.reasoning_tokens;
    const hasTokens = Number.isSafeInteger(tokens) && tokens >= 0;
    const delta = fields?.content;
    const hasAnswer = typeof delta === 'string' && !!delta;
    const hasThinking = reasoning !== null || hasTokens;
    if (!answerStarted && hasThinking && thinkingStartedAt === null) thinkingStartedAt = Date.now();
    if (!answerStarted && reasoning) thinkingCharacters += Array.from(reasoning).length;
    if (hasTokens) thinkingTokens = Math.max(thinkingTokens ?? 0, tokens);
    const progress = () => ({ count: thinkingTokens ?? (thinkingCharacters || null),
      unit: thinkingTokens === null ? 'characters' : 'tokens', startedAt: thinkingStartedAt });
    if (thinkingStartedAt !== null) {
      if (!answerStarted && hasAnswer) {
        thinkingDurationMs = Math.max(0, Date.now() - thinkingStartedAt);
        emitThinking({ type: 'THINKING_SUMMARY', ...progress(), durationMs: thinkingDurationMs });
      } else if (answerStarted && hasTokens) {
        emitThinking({ type: 'THINKING_SUMMARY', ...progress(), durationMs: thinkingDurationMs });
      } else if (!answerStarted && hasThinking) {
        emitThinking({ type: 'THINKING', ...progress() });
      }
    }
    if (!hasAnswer) return;
    answerStarted = true;
    answer += delta;
    if (answer.length > MAX_ANSWER) throw new Error('模型回复超过长度限制。');
    emit(delta);
  }

  try {
    while (!finished) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value?.byteLength) resetIdle();
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
    reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!finished) throw new Error('模型输出中途断开，请重试。');
  if (!answer.trim()) throw new Error('模型接口没有返回可显示的分析内容。');
  return answer;
}

async function readJsonWithActivity(response, resetIdle) {
  if (!response.body?.getReader) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value?.byteLength) resetIdle();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function analyze(prompt, images, sender, emit, emitThinking, controller, resetIdle) {
  validateSender(sender);
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 24000) {
    throw new Error('分析内容无效或超过长度限制。');
  }
  if (images != null && (!Array.isArray(images) || images.length > MAX_IMAGES)) {
    throw new Error('题图数量无效或超过限制。');
  }
  let totalImageBytes = 0;
  for (const image of images || []) {
    const match = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match || match[1].length % 4 !== 0) throw new Error('题图数据格式无效。');
    const size = match[1].length * 3 / 4 - (match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0);
    totalImageBytes += size;
    if (size > MAX_IMAGE_BYTES || totalImageBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error('题图超过图片大小限制。');
  }
  await requireDataConsent();
  await restrictStorage();
  const settings = await chrome.storage.local.get(['baseUrl', 'apiKey', 'model', 'reasoningEffort', 'systemPrompt']);
  const baseUrl = allowedBaseUrl(settings.baseUrl || DEFAULTS.baseUrl);
  const apiKey = String(settings.apiKey || '').trim();
  const model = String(settings.model || DEFAULTS.model).trim();
  const reasoningEffort = String(settings.reasoningEffort ?? '').trim();
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
  const userContent = images?.length ? [{ type: 'text', text: prompt },
    ...images.flatMap((image, index) => [{ type: 'text', text: `题图 ${index + 1}：` },
      { type: 'image_url', image_url: { url: image } }])] : prompt;
  const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }];

  async function request(stream) {
    await requireDataConsent();
    resetIdle();
    try {
      return await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, stream, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) }),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason || error;
      if (error?.name === 'AbortError') throw error;
      throw new Error('无法连接模型接口，请检查地址、网络和接口权限。');
    }
  }

  let response = await request(true);
  if (!response.ok) {
    const detail = await errorDetail(response);
    if (!rejectsStreaming(response.status, detail)) throw httpError(response.status, detail, apiKey);
    response = await request(false);
  }
  if (!response.ok) throw httpError(response.status, await errorDetail(response), apiKey);
  resetIdle();
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
    let payload;
    try { payload = await readJsonWithActivity(response, resetIdle); }
    catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new Error('模型接口返回的不是有效 JSON。');
    }
    if (payload?.choices?.[0]?.finish_reason === 'length') throw new Error('模型回答达到长度上限，请调整请求后重试。');
    const answer = answerFromJson(payload);
    emit(answer);
    return answer;
  } else {
    return consumeEvents(response, emit, emitThinking, resetIdle, apiKey);
  }
}

async function testConnection(message, sender) {
  if (sender?.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('src/options.html')) {
    throw new Error('只能从插件设置页测试连接。');
  }
  await requireDataConsent();
  const settings = message.settings || {};
  const baseUrl = allowedBaseUrl(settings.baseUrl);
  const apiKey = String(settings.apiKey || '').trim();
  const model = String(settings.model || '').trim();
  const reasoningEffort = String(settings.reasoningEffort || '').trim();
  if (!baseUrl || !apiKey || !model) throw new Error('请填写有效的地址、API Key 和模型名称。');
  const apiUrl = new URL(baseUrl);
  const origin = `${apiUrl.protocol}//${apiUrl.hostname}/*`;
  if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error('尚未授权访问模型接口。');
  const controller = new AbortController();
  activeRequests.add(controller);
  let timedOut = false;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error('测试连接超时，请稍后重试。'));
    }, 15000);
  });
  try {
    return await Promise.race([(async () => {
      await requireDataConsent();
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: '请回复：连接正常' }], stream: false,
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) }),
        signal: controller.signal
      });
      if (!response.ok) throw httpError(response.status, await errorDetail(response), apiKey);
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error('模型接口返回的不是有效 JSON。'); }
      if (payload?.choices?.[0]?.finish_reason === 'length') throw new Error('模型回答达到长度上限。');
      answerFromJson(payload);
      return { ok: true };
    })(), deadline]);
  } catch (error) {
    if (!timedOut && controller.signal.aborted && controller.signal.reason?.name === 'Error') throw controller.signal.reason;
    if (timedOut || error?.name === 'AbortError') throw new Error('测试连接超时，请稍后重试。');
    throw error;
  } finally { clearTimeout(timer); activeRequests.delete(controller); }
}

// Firefox 140 之前没有内置的数据发送授权；Chrome 不需要此兼容界面。
const DATA_CONSENT_VERSION = 1;
const activeRequests = new Set();
async function requireDataConsent() {
  if (!chrome.runtime.getManifest?.().browser_specific_settings?.gecko) return;
  const permissions = await chrome.permissions.getAll();
  if ('data_collection' in permissions) return;
  const saved = await chrome.storage.local.get('dataTransmissionConsent');
  if (saved.dataTransmissionConsent?.version !== DATA_CONSENT_VERSION || saved.dataTransmissionConsent.granted !== true) {
    throw new Error('请先在插件设置中同意数据发送；可随时撤回授权。');
  }
}

// 仅在长任务执行期间调用扩展 API，兼容 Chrome 110 的后台休眠机制。
function keepBackgroundActive(signal) {
  if (!chrome.runtime.getPlatformInfo || signal?.aborted) return () => {};
  let timer;
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  };
  const tick = () => {
    if (stopped) return;
    chrome.runtime.getPlatformInfo(() => { void chrome.runtime.lastError; });
    timer = setTimeout(tick, 20000);
  };
  timer = setTimeout(tick, 20000);
  signal?.addEventListener('abort', stop, { once: true });
  return stop;
}

chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !changes.dataTransmissionConsent) return;
  const value = changes.dataTransmissionConsent.newValue;
  if (value?.version === DATA_CONSENT_VERSION && value.granted) return;
  for (const controller of activeRequests) controller.abort(new Error('数据发送授权已撤回，请在插件设置中重新授权。'));
  bridgeGeneration++;
  bridgePollController?.abort();
});

chrome.runtime.onInstalled.addListener(() => { restrictStorage().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { restrictStorage().catch(console.error); });
restrictStorage().catch(console.error);
chrome.action.onClicked.addListener(tab => { openOptionsPopup(tab?.windowId).catch(console.error); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['OPEN_OPTIONS', 'GET_CACHED_RESULT', 'TEST_CONNECTION', 'IDE_IMPORT', 'IDE_BRIDGE_READY'].includes(message?.type)) return false;
  (async () => {
    if (message.type === 'IDE_IMPORT') return importToIde(message.problem, sender);
    if (message.type === 'IDE_BRIDGE_READY') { await rememberBridgeTab(sender); return { ok: true }; }
    if (message.type === 'TEST_CONNECTION') return testConnection(message, sender);
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
  let stopKeepingActive = () => {};
  port.onDisconnect.addListener(() => { disconnected = true; controller.abort(); stopKeepingActive(); });
  port.onMessage.addListener(message => {
    if (message?.type === 'PING') return;
    if (started || message?.type !== 'ANALYZE') return;
    started = true;
    activeRequests.add(controller);
    stopKeepingActive = keepBackgroundActive(controller.signal);
    const timeout = timeoutFor(controller);
    const post = event => {
      if (disconnected) return;
      try { port.postMessage(event); }
      catch { disconnected = true; controller.abort(); }
    };
    analyze(message.prompt, message.images, port.sender, text => post({ type: 'DELTA', text }),
      progress => post(progress), controller, timeout.resetIdle)
      .then(async answer => {
        if (!disconnected) {
          try {
            await saveResult(port.sender.url, answer);
            post({ type: 'DONE' });
          } catch (error) {
            console.error(error);
            post({ type: 'ERROR', error: '分析已完成，但缓存保存失败。刷新后可能无法恢复，请重试。' });
          }
        }
      }, error => {
        if (disconnected) return;
        const reason = timeout.didTimeOut() || error?.name === 'AbortError'
          ? '模型接口连续 45 秒未返回新数据，请重试。'
          : error?.message || '操作失败。';
        post({ type: 'ERROR', error: reason });
      }).finally(() => { timeout.clear(); stopKeepingActive(); activeRequests.delete(controller); if (!disconnected) port.disconnect(); });
  });
});

// IDE 导入单独验证题目页，不放宽原有分析消息的提交页限制。
function ideSource(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    let path = url.pathname;
    const vpn = url.hostname === 'webvpn.neu.edu.cn';
    if (vpn) {
      if (!path.startsWith(`${VPN_PREFIX}/`)) return null;
      path = path.slice(VPN_PREFIX.length);
    } else if (url.hostname !== 'oj.neu.edu.cn') return null;
    if (!/^\/(?:problems\/[A-Za-z0-9]+|training\/\d+\/part\/\d+\/problem\/[A-Za-z0-9]+|group\/\d+\/(?:problems|problem)\/[A-Za-z0-9]+|(?:contest|exam)\/\d+\/problem\/[A-Za-z0-9]+)\/?$/.test(path)) return null;
    return vpn ? `webvpn:${path.replace(/\/$/, '')}` : `https://oj.neu.edu.cn${path.replace(/\/$/, '')}`;
  } catch { return null; }
}

function ideScope(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname === 'oj.neu.edu.cn') return url.origin;
    if (url.hostname === 'webvpn.neu.edu.cn' && url.pathname.startsWith(`${VPN_PREFIX}/`)) return `${url.origin}${VPN_PREFIX}`;
  } catch { /* 无效地址。 */ }
  return null;
}

async function bridgeToken(create = false) {
  const storage = chrome.storage.session;
  if (!storage) throw new Error('浏览器不支持本次会话的 IDE 配对存储。');
  const saved = await storage.get(BRIDGE_TOKEN_KEY);
  if (typeof saved[BRIDGE_TOKEN_KEY] === 'string') return saved[BRIDGE_TOKEN_KEY];
  if (!create) return null;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  await storage.set({ [BRIDGE_TOKEN_KEY]: token });
  return token;
}

function validBridgeCapabilities(value) {
  return value?.service === 'neuoj-ide-bridge' && value.protocolVersion === 1 && value.ide === 'CLion' &&
    BRIDGE_INSTANCE_ID.test(value.instanceId || '') &&
    Array.isArray(value.capabilities) && value.capabilities.includes('importProblem') &&
    value.capabilities.includes('submitCode');
}

function bridgeUrl(port, path) { return `http://127.0.0.1:${port}/v1/${path}`; }

async function bridgeCapabilities(port, timeout = 1500) {
  await requireDataConsent();
  const controller = new AbortController();
  activeRequests.add(controller);
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(bridgeUrl(port, 'capabilities'), {
      signal: controller.signal, credentials: 'omit', redirect: 'error'
    });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
  finally { clearTimeout(timer); activeRequests.delete(controller); }
}

async function discoverBridge() {
  const responses = await Promise.all(BRIDGE_PORTS.map(async port => ({ port, value: await bridgeCapabilities(port) })));
  const matches = responses.filter(({ value }) => validBridgeCapabilities(value));
  if (matches.length > 1) throw new Error('发现多个 CLion 实例，请只保留目标 CLion 运行后重试。');
  if (!matches.length) {
    if (responses.some(({ value }) => value?.service === 'neuoj-ide-bridge')) {
      throw new Error('CLion 插件协议不兼容，请同时更新浏览器扩展和 CLion 插件。');
    }
    throw new Error('无法连接 CLion，请确认插件已启动且本机端口 39271–39280 未全部占用。');
  }
  return { port: matches[0].port, instanceId: matches[0].value.instanceId };
}

async function storedBridgeEndpoint() {
  const saved = await chrome.storage.session.get(BRIDGE_ENDPOINT_KEY);
  const endpoint = saved[BRIDGE_ENDPOINT_KEY];
  return BRIDGE_PORTS.includes(endpoint?.port) && BRIDGE_INSTANCE_ID.test(endpoint.instanceId || '')
    ? endpoint : null;
}

async function bridgeEndpointState(endpoint) {
  const capabilities = await bridgeCapabilities(endpoint.port);
  if (!validBridgeCapabilities(capabilities)) return 'unavailable';
  return capabilities.instanceId === endpoint.instanceId ? 'connected' : 'changed';
}

async function rememberBridgeTab(sender) {
  const scope = ideScope(sender?.url);
  const tabId = sender?.tab?.id;
  if (!scope || !Number.isInteger(tabId)) throw new Error('NEUOJ 页面无效。');
  const storage = chrome.storage.session;
  if (!storage) return;
  const saved = await storage.get(BRIDGE_TABS_KEY);
  const tabs = Array.isArray(saved[BRIDGE_TABS_KEY]) ? saved[BRIDGE_TABS_KEY] : [];
  await storage.set({ [BRIDGE_TABS_KEY]: [{ tabId, scope }, ...tabs.filter(item => item.tabId !== tabId)].slice(0, 20) });
}

async function postBridgeResult(endpoint, token, result) {
  await requireDataConsent();
  const controller = new AbortController();
  activeRequests.add(controller);
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(bridgeUrl(endpoint.port, 'submissions/results'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NEUOJ-Pair': token },
      body: JSON.stringify(result), credentials: 'omit', redirect: 'error', signal: controller.signal
    });
    if (!response.ok) throw new Error(`IDE 未接受提交结果（${response.status}）。`);
  } finally { clearTimeout(timer); activeRequests.delete(controller); }
}

async function dispatchSubmission(job) {
  if (!job || typeof job.id !== 'string' || ideSource(job.url) !== job.problemId ||
    !['C', 'C++14'].includes(job.language) || typeof job.source !== 'string' ||
    job.source.length > 1_048_576) return { id: job?.id || '', ok: false, error: '提交任务无效。' };
  await requireDataConsent();
  const scope = ideScope(job.url);
  const saved = await chrome.storage.session.get(BRIDGE_TABS_KEY);
  const tabs = (saved[BRIDGE_TABS_KEY] || []).filter(item => item.scope === scope);
  let item;
  for (const candidate of tabs) {
    try {
      const tab = await chrome.tabs.get(candidate.tabId);
      if (!tab.url || ideScope(tab.url) === scope) { item = candidate; break; }
    } catch { /* 已关闭的标签页没有收到任务，可继续查找。 */ }
  }
  if (!item) return { id: job.id, ok: false, error: '请在浏览器中保留已登录的 NEUOJ 标签页，并重新导入题目。' };
  try {
    await requireDataConsent();
    const result = await chrome.tabs.sendMessage(item.tabId, { type: 'IDE_SUBMIT', job });
    if (result && typeof result.ok === 'boolean') return { id: job.id, ok: result.ok,
      ...(result.url ? { url: result.url } : {}), ...(result.error ? { error: result.error } : {}) };
  } catch { /* 可能已经发出提交，不换其他标签页重试。 */ }
  return { id: job.id, ok: false, error: '请在 NEUOJ 提交记录中核对提交结果。' };
}

async function pollBridge(endpoint, token, generation = bridgeGeneration) {
  await requireDataConsent();
  const controller = new AbortController();
  activeRequests.add(controller);
  bridgePollController = controller;
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(bridgeUrl(endpoint.port, 'submissions/next'), {
      headers: { 'X-NEUOJ-Pair': token }, signal: controller.signal, credentials: 'omit', redirect: 'error'
    });
    if (controller.signal.aborted || generation !== bridgeGeneration) return false;
    if (response.status === 204) return false;
    if (!response.ok) throw new Error(`IDE 连接失败（${response.status}）。`);
    const job = await response.json();
    if (controller.signal.aborted || generation !== bridgeGeneration) return false;
    const result = await dispatchSubmission(job);
    await postBridgeResult(endpoint, token, result);
    return true;
  } finally { clearTimeout(timer); activeRequests.delete(controller); if (bridgePollController === controller) bridgePollController = null; }
}

function startBridge() {
  if (bridgeLoop) return bridgeLoop;
  const generation = bridgeGeneration;
  let stopKeepingActive = () => {};
  bridgeLoop = (async () => {
    const token = await bridgeToken();
    const endpoint = await storedBridgeEndpoint();
    if (!token || !endpoint) return;
    await requireDataConsent();
    stopKeepingActive = keepBackgroundActive();
    let failures = 0;
    while (generation === bridgeGeneration) {
      const state = await bridgeEndpointState(endpoint);
      if (state === 'changed') {
        console.warn('CLion 实例已变化，请重新导入题目完成配对。');
        return;
      }
      if (state === 'unavailable') {
        if (++failures >= 2) return;
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }
      try {
        const received = await pollBridge(endpoint, token, generation);
        failures = 0;
        if (!received) await new Promise(resolve => setTimeout(resolve, 1000));
      }
      catch {
        if (generation !== bridgeGeneration) return;
        if (++failures >= 2) return;
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  })().finally(() => {
    stopKeepingActive();
    bridgeLoop = null;
    if (generation !== bridgeGeneration) startBridge().catch(console.error);
  });
  return bridgeLoop;
}

chrome.runtime.onStartup.addListener(() => { startBridge().catch(console.error); });
if (chrome.alarms) chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'neuoj-bridge') startBridge().catch(console.error);
});

async function importToIde(problem, sender) {
  await requireDataConsent();
  const identity = ideSource(sender?.url);
  if (!identity || problem?.id !== identity || ideSource(problem?.url) !== identity || problem.protocolVersion !== 1 ||
    typeof problem.title !== 'string' || typeof problem.statement !== 'string' ||
    !Array.isArray(problem.samples) || !problem.samples.length || problem.samples.length > 100 ||
    problem.samples.some(sample => typeof sample.id !== 'string' || typeof sample.input !== 'string' || typeof sample.output !== 'string')) {
    throw new Error('题目导入数据无效。');
  }
  const body = JSON.stringify(problem);
  if (body.length > 2 * 1024 * 1024) throw new Error('题目数据过大。');
  const endpoint = await discoverBridge();
  const token = await bridgeToken(true);
  const controller = new AbortController();
  activeRequests.add(controller);
  const timer = setTimeout(() => controller.abort(), 10000);
  async function request(path, options = {}) {
    await requireDataConsent();
    const response = await fetch(bridgeUrl(endpoint.port, path), {
      ...options, headers: { 'Content-Type': 'application/json', 'X-NEUOJ-Pair': token },
      signal: controller.signal, redirect: 'error', credentials: 'omit'
    });
    if (response.status === 403) throw new Error('IDE 拒绝了当前扩展的连接来源。');
    if (!response.ok) throw new Error(response.status === 409 ? '请在 CLion 中打开并选中本地代码文件。' : `IDE 请求失败（${response.status}）。`);
    try { return await response.json(); } catch { throw new Error('IDE 返回数据无效。'); }
  }
  try {
    const capabilities = await bridgeCapabilities(endpoint.port);
    if (!validBridgeCapabilities(capabilities) || capabilities.instanceId !== endpoint.instanceId) {
      throw new Error('CLion 实例已变化，请重新点击导入题目。');
    }
    const result = await request('problems', { method: 'POST', body });
    if (!result.ok) throw new Error('IDE 未能完成导入。');
    const previous = await storedBridgeEndpoint();
    await chrome.storage.session.set({ [BRIDGE_ENDPOINT_KEY]: endpoint });
    if (!previous || previous.port !== endpoint.port || previous.instanceId !== endpoint.instanceId) {
      bridgeGeneration++;
      bridgePollController?.abort();
    }
    await rememberBridgeTab(sender);
    if (chrome.alarms) {
      await chrome.alarms.create('neuoj-bridge', { periodInMinutes: 1 });
      startBridge().catch(console.error);
    }
    return { ok: true };
  } catch (error) {
    if (controller.signal.aborted) {
      if (controller.signal.reason?.name === 'Error') throw controller.signal.reason;
      throw new Error('IDE 连接超时。');
    }
    if (error instanceof TypeError) throw new Error('无法连接 CLion，请确认插件已启动。');
    throw error;
  } finally { clearTimeout(timer); activeRequests.delete(controller); }
}
