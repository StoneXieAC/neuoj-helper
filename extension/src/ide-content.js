(function () {
  'use strict';
  const core = globalThis.NEUOJCore;
  function mountIde() {
    if (!core.problemIdentity(location.href) || !document.getElementById('problem-content-vditor') ||
      document.getElementById('neuoj-ide-import')) return;
    const host = document.createElement('div');
    host.id = 'neuoj-ide-import';
    const shadow = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.textContent = '导入到 IDE';
    button.style.cssText = 'padding:8px 16px;margin:8px;background:#066fd1;color:white;border:0;border-radius:6px;cursor:pointer';
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    const settings = document.createElement('button');
    settings.textContent = '连接设置';
    settings.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_IDE_OPTIONS' }));
    shadow.append(button, settings, status);
    document.getElementById('problem-content-vditor').before(host);
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = '正在导入…';
      try {
        const problem = core.extractIdeProblem(document, location.href);
        const result = await new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: 'IDE_IMPORT', problem }, response => {
          if (chrome.runtime.lastError) reject(new Error('扩展连接中断，请重新加载扩展。'));
          else resolve(response);
        }));
        if (!result?.ok) throw new Error(result?.error || '导入失败。');
        status.textContent = '已导入 IDE。';
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    });
  }
  mountIde();
  const observer = new MutationObserver(mountIde);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
})();
