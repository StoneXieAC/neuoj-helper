(function () {
  'use strict';
  const core = globalThis.NEUOJCore;
  const vpnPrefix = '/https/62304135386136393339346365373340bfebea318fd008d8f60d257088';
  function sameEntry(a, b) {
    try {
      const left = new URL(a);
      const right = new URL(b);
      if (left.origin !== right.origin || left.protocol !== 'https:') return false;
      return left.hostname === 'oj.neu.edu.cn' ||
        (left.hostname === 'webvpn.neu.edu.cn' && left.pathname.startsWith(`${vpnPrefix}/`) && right.pathname.startsWith(`${vpnPrefix}/`));
    } catch { return false; }
  }
  function submissionLink(raw, problemUrl) {
    try {
      const url = new URL(raw);
      if (!sameEntry(url.href, problemUrl) || url.username || url.password || url.port) return null;
      const path = url.hostname === 'webvpn.neu.edu.cn' ? url.pathname.slice(vpnPrefix.length) : url.pathname;
      if (!/^\/(?:[a-z]+\/\d+\/)*submissions?\/\d+\/?$/.test(path)) return null;
      url.hash = '';
      return url.href;
    } catch { return null; }
  }
  function resolveSubmissionAction(form, pageUrl) {
    const raw = form.getAttribute('action')?.trim() || pageUrl;
    let action = new URL(raw, pageUrl);
    const page = new URL(pageUrl);
    if (page.hostname === 'webvpn.neu.edu.cn') {
      if (action.origin === 'https://oj.neu.edu.cn' && !action.username && !action.password && !action.port) {
        action = new URL(`${vpnPrefix}${action.pathname}${action.search}${action.hash}`, pageUrl);
      } else if (raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith(`${vpnPrefix}/`) &&
        action.origin === page.origin) {
        action = new URL(`${vpnPrefix}${raw}`, pageUrl);
      }
    }
    return action;
  }
  function findSubmissionForm(doc) {
    return [...doc.forms].find(form => form.querySelector('select[name="language_id"]') &&
      form.querySelector('input[name="_token"]'));
  }
  function submissionActionMatches(action, problemId) {
    const path = action.hostname === 'webvpn.neu.edu.cn' ? action.pathname.slice(vpnPrefix.length) : action.pathname;
    const match = path.match(/^\/(?:(training|trainings|group|groups|contest|contests|exam|exams)\/(\d+)\/)?(?:(part|parts)\/(\d+)\/)?(problem|problems)\/([A-Za-z0-9]+)\/submissions\/?$/);
    if (!match) return false;
    const scope = match[1] ? `/${match[1].replace(/s$/, '')}/${match[2]}` : '';
    const part = match[3] ? `/part/${match[4]}` : '';
    const problem = scope && !scope.startsWith('/group/') ? 'problem' : match[5];
    const candidate = `${action.origin}${action.hostname === 'webvpn.neu.edu.cn' ? vpnPrefix : ''}${scope}${part}/${problem}/${match[6]}`;
    return core.problemIdentity(candidate)?.id === problemId;
  }
  async function submitToNeuoj(job) {
    if (!job || core.problemIdentity(job.url)?.id !== job.problemId || !sameEntry(location.href, job.url) ||
      !['C', 'C++14'].includes(job.language) || typeof job.source !== 'string' || !job.source.trim()) {
      throw new Error('提交任务与当前 NEUOJ 页面不匹配。');
    }
    const page = await fetch(job.url, { credentials: 'same-origin', redirect: 'follow' });
    if (!page.ok || core.problemIdentity(page.url)?.id !== job.problemId) throw new Error('无法读取题目提交表单，请检查登录状态。');
    const liveForm = core.problemIdentity(location.href)?.id === job.problemId && findSubmissionForm(document);
    const doc = liveForm ? document : new DOMParser().parseFromString(await page.text(), 'text/html');
    const form = liveForm || findSubmissionForm(doc);
    if (!form) throw new Error('NEUOJ 提交表单已变化：未找到语言与令牌字段。');
    const action = resolveSubmissionAction(form, liveForm ? location.href : page.url);
    const problemAction = core.problemIdentity(action.href)?.id === job.problemId;
    const submissionAction = submissionActionMatches(action, job.problemId);
    if (form.method.toUpperCase() !== 'POST' || !sameEntry(action.href, job.url) ||
      action.username || action.password || action.port || (!problemAction && !submissionAction) || action.search || action.hash) {
      throw new Error(`NEUOJ 提交表单已变化：提交地址 ${action.pathname} 不匹配。`);
    }
    const csrf = form.querySelector('input[name="_token"]')?.value || doc.querySelector('meta[name="csrf-token"]')?.content;
    const options = [...form.querySelectorAll('select[name="language_id"] option')];
    const selected = options.find(option => job.language === 'C' ? /^C\s*\(gcc\)$/i.test(option.textContent.trim()) : /^C\+\+14$/i.test(option.textContent.trim()));
    if (!csrf || !selected) throw new Error('提交令牌或语言选项缺失。');
    const body = new URLSearchParams({ _token: csrf, language_id: selected.value, source_code: job.source });
    const response = await fetch(action.href, {
      method: 'POST', body, credentials: 'same-origin', redirect: 'follow',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }
    });
    const link = response.ok && submissionLink(response.url, job.url);
    if (link) return { ok: true, url: link };
    const result = new DOMParser().parseFromString(await response.text(), 'text/html');
    const message = result.querySelector('.alert-danger, .invalid-feedback, [role="alert"]')?.textContent?.trim();
    throw new Error(message?.slice(0, 300) || '请在 NEUOJ 提交记录中核对提交结果。');
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'IDE_SUBMIT') return false;
    submitToNeuoj(message.job).then(result => sendResponse(result), error => sendResponse({ ok: false, error: error.message || '提交失败。' }));
    return true;
  });
  chrome.runtime.sendMessage({ type: 'IDE_BRIDGE_READY' }, () => { void chrome.runtime.lastError; });
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
        status.textContent = '已导入 IDE';
      } catch (error) { status.dataset.state = 'error'; status.textContent = error.message; }
      finally { button.disabled = false; }
    });
  }
  mountIde();
  const observer = new MutationObserver(mountIde);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
})();
