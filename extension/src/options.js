'use strict';

const form = document.getElementById('settings');
const message = document.getElementById('message');
const fields = {
  baseUrl: document.getElementById('baseUrl'),
  apiKey: document.getElementById('apiKey'),
  model: document.getElementById('model'),
  reasoningEffort: document.getElementById('reasoningEffort')
};

function parseBaseUrl(input) {
  try {
    const url = new URL(input.trim());
    const loopback = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw Error();
    if (url.username || url.password || url.search || url.hash) throw Error();
    return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}`;
  } catch { return null; }
}

chrome.storage.local.get(['baseUrl', 'apiKey', 'model', 'reasoningEffort']).then(saved => {
  fields.baseUrl.value = saved.baseUrl || 'https://api.deepseek.com';
  fields.apiKey.value = saved.apiKey || '';
  fields.model.value = saved.model || 'deepseek-flash';
  fields.reasoningEffort.value = saved.reasoningEffort ?? 'low';
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const baseUrl = parseBaseUrl(fields.baseUrl.value);
  const apiKey = fields.apiKey.value.trim();
  const model = fields.model.value.trim();
  const reasoningEffort = fields.reasoningEffort.value.trim();
  if (!baseUrl || !apiKey || !model) {
    message.textContent = '请填写有效的地址、API Key 和模型名称。接口地址须为 HTTPS 或本机 HTTP。';
    return;
  }
  message.textContent = '';
  const apiUrl = new URL(baseUrl);
  const origin = `${apiUrl.protocol}//${apiUrl.hostname}/*`;
  try {
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) { message.textContent = '未获得接口域名权限，设置未保存。'; return; }
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.local.set({ baseUrl, apiKey, model, reasoningEffort });
    message.textContent = '设置已保存。返回提交页面即可分析。';
  } catch (error) { message.textContent = `保存失败：${error.message}`; }
});
