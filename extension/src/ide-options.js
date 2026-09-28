'use strict';
const ideForm = document.getElementById('ide-settings');
const idePort = document.getElementById('idePort');
const ideMessage = document.getElementById('ide-message');
chrome.storage.local.get(['idePort']).then(saved => {
  idePort.value = saved.idePort || 27121;
  Promise.resolve(chrome.storage.local.remove?.('ideToken')).catch(() => {});
}).catch(() => { ideMessage.textContent = '无法读取 IDE 设置。'; });
ideForm.addEventListener('submit', async event => {
  event.preventDefault();
  const port = Number(idePort.value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    ideMessage.textContent = '请输入有效端口。';
    return;
  }
  try {
    await chrome.storage.local.set({ idePort: port });
    ideMessage.textContent = 'IDE 连接设置已保存。';
  } catch { ideMessage.textContent = '保存 IDE 设置失败。'; }
});
