'use strict';

const CATEGORIES = [
  { id: 'api', label: 'API 设置', panelId: 'api-panel' },
  { id: 'prompt', label: '提示词设置', panelId: 'prompt-panel' }
];
const form = document.getElementById('settings');
const message = document.getElementById('message');
const saveButton = document.getElementById('save');
const fields = {
  baseUrl: document.getElementById('baseUrl'),
  apiKey: document.getElementById('apiKey'),
  model: document.getElementById('model'),
  reasoningEffort: document.getElementById('reasoningEffort'),
  systemPrompt: document.getElementById('systemPrompt')
};
let defaultPrompt = '';

function selectCategory(id, focus = false) {
  for (const category of CATEGORIES) {
    const selected = category.id === id;
    const tab = document.getElementById(`${category.id}-tab`);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(category.panelId).hidden = !selected;
    if (selected && focus) tab.focus();
  }
}

const navigation = document.getElementById('categories');
for (const category of CATEGORIES) {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.id = `${category.id}-tab`;
  tab.textContent = category.label;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', category.panelId);
  tab.addEventListener('click', () => selectCategory(category.id));
  tab.addEventListener('keydown', event => {
    const current = CATEGORIES.findIndex(item => item.id === category.id);
    const index = event.key === 'ArrowDown' ? (current + 1) % CATEGORIES.length
      : event.key === 'ArrowUp' ? (current - 1 + CATEGORIES.length) % CATEGORIES.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? CATEGORIES.length - 1 : -1;
    if (index < 0) return;
    event.preventDefault();
    selectCategory(CATEGORIES[index].id, true);
  });
  navigation.append(tab);
}
navigation.setAttribute('role', 'tablist');
for (const category of CATEGORIES) document.getElementById(category.panelId).setAttribute('role', 'tabpanel');
selectCategory(CATEGORIES[0].id);

function parseBaseUrl(input) {
  try {
    const url = new URL(input.trim());
    const loopback = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw Error();
    if (url.username || url.password || url.search || url.hash) throw Error();
    return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}`;
  } catch { return null; }
}

Promise.all([
  chrome.storage.local.get(['baseUrl', 'apiKey', 'model', 'reasoningEffort', 'systemPrompt']),
  fetch(chrome.runtime.getURL('prompts/system.md')).then(async response => {
    if (!response.ok) throw new Error('无法读取内置提示词。');
    return (await response.text()).trim();
  })
]).then(([saved, prompt]) => {
  if (!prompt) throw new Error('内置提示词为空。');
  defaultPrompt = prompt;
  fields.baseUrl.value = saved.baseUrl || 'https://api.deepseek.com';
  fields.apiKey.value = saved.apiKey || '';
  fields.model.value = saved.model || 'deepseek-flash';
  fields.reasoningEffort.value = saved.reasoningEffort ?? 'low';
  fields.systemPrompt.value = saved.systemPrompt == null ? prompt : saved.systemPrompt;
  saveButton.disabled = false;
}).catch(error => {
  message.textContent = `加载设置失败：${error.message}`;
});

document.getElementById('restoreDefault').addEventListener('click', () => {
  fields.systemPrompt.value = defaultPrompt;
  message.textContent = '';
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saveButton.disabled) return;
  const baseUrl = parseBaseUrl(fields.baseUrl.value);
  const apiKey = fields.apiKey.value.trim();
  const model = fields.model.value.trim();
  const reasoningEffort = fields.reasoningEffort.value.trim();
  const systemPrompt = fields.systemPrompt.value;
  if (!baseUrl || !apiKey || !model) {
    selectCategory('api');
    message.textContent = '请填写有效的地址、API Key 和模型名称。接口地址须为 HTTPS 或本机 HTTP。';
    return;
  }
  if (!systemPrompt.trim() || systemPrompt.length > 10000) {
    selectCategory('prompt');
    message.textContent = '系统提示词不能为空或超过 10000 字符。';
    return;
  }
  message.textContent = '';
  saveButton.disabled = true;
  const apiUrl = new URL(baseUrl);
  const origin = `${apiUrl.protocol}//${apiUrl.hostname}/*`;
  try {
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) { selectCategory('api'); message.textContent = '未获得接口域名权限，设置未保存。'; return; }
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.local.set({ baseUrl, apiKey, model, reasoningEffort,
      systemPrompt: systemPrompt.trim() === defaultPrompt ? null : systemPrompt });
    window.close();
  } catch (error) {
    message.textContent = `保存失败：${error.message}`;
  } finally { saveButton.disabled = false; }
});
