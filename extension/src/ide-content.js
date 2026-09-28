(function () {
  'use strict';
  const core = globalThis.NEUOJCore;
  function mountIde() {
    if (!core.problemIdentity(location.href) || !document.getElementById('problem-content-vditor') ||
      document.getElementById('neuoj-ide-import')) return;
    const host = document.createElement('div');
    host.id = 'neuoj-ide-import';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { display:block; margin:16px 0; color:#213047; font:14px/1.6 system-ui,-apple-system,sans-serif; }
      .panel { border:1px solid #cbd5e1; border-radius:12px; background:#fff; box-shadow:0 2px 12px #1e293b0c; padding:16px; }
      .top { display:flex; align-items:flex-start; gap:8px; }
      .actions { display:flex; align-items:center; flex:1; flex-wrap:wrap; gap:8px; min-width:0; }
      button { box-sizing:border-box; border:1px solid transparent; border-radius:4px; padding:5px 8px; background:#066fd1; color:white; cursor:pointer; font:500 12px/16px system-ui,-apple-system,sans-serif; white-space:nowrap; }
      button:hover:not(:disabled) { background:#005fba; }
      button:disabled { opacity:.55; cursor:default; }
      button:focus-visible { outline:2px solid #066fd1; outline-offset:2px; }
      .status[hidden] { display:none; }
      .status { display:inline-flex; align-items:center; gap:5px; min-width:0; max-width:100%; color:#64748b; font:500 12px/20px system-ui,-apple-system,sans-serif; overflow-wrap:anywhere; }
      .status[data-state="success"] { color:#15803d; }
      .status[data-state="error"] { color:#b42318; }
    `;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '导入题目';
    const status = document.createElement('span');
    status.className = 'status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    const panel = document.createElement('section');
    panel.className = 'panel';
    const top = document.createElement('div');
    top.className = 'top';
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(button, status);
    top.append(actions);
    panel.append(top);
    shadow.append(style, panel);
    document.getElementById('problem-content-vditor').before(host);
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.hidden = false;
      status.dataset.state = 'loading';
      status.textContent = '正在导入…';
      try {
        const problem = core.extractIdeProblem(document, location.href);
        const result = await new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: 'IDE_IMPORT', problem }, response => {
          if (chrome.runtime.lastError) reject(new Error('扩展连接中断，请重新加载扩展。'));
          else resolve(response);
        }));
        if (!result?.ok) throw new Error(result?.error || '导入失败。');
        status.dataset.state = 'success';
        status.textContent = '已导入 IDE。';
      } catch (error) { status.dataset.state = 'error'; status.textContent = error.message; }
      finally { button.disabled = false; }
    });
  }
  mountIde();
  const observer = new MutationObserver(mountIde);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
})();
