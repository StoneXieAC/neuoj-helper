(() => {
  'use strict';
  const core = globalThis.NEUOJCore;
  if (!core || !globalThis.markdownit || !core.isSubmissionUrl(location.href)) return;
  const markdown = globalThis.markdownit({ html: false, linkify: false, breaks: true });
  markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content);
  const validateLink = markdown.validateLink.bind(markdown);
  markdown.validateLink = url => validateLink(url) && /^https?:\/\//i.test(url);
  markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return self.renderToken(tokens, index, options);
  };
  let mounted = false;
  let observer;

  function mount() {
    if (mounted || !core.isSubmissionPage(document, location.href)) return false;
    const report = core.extractSubmission(document, location.href);
    if (!report) return false;
    const host = document.createElement('div');
    host.id = 'neuoj-helper-root';
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
      .settings { display:grid; place-items:center; flex:0 0 28px; width:28px; height:28px; margin-left:auto; padding:0; border-color:#d9e1ec; background:#fff; color:#64748b; }
      .settings:hover:not(:disabled) { border-color:#b9c7d9; background:#f1f5f9; color:#334155; }
      .settings svg { width:16px; height:16px; }
      .status[hidden] { display:none; }
      .status { display:inline-flex; align-items:center; gap:5px; min-width:0; max-width:100%; color:#64748b; font:500 12px/20px system-ui,-apple-system,sans-serif; overflow-wrap:anywhere; }
      .status[data-state="success"] { color:#15803d; }
      .status[data-state="error"] { color:#b42318; }
      .status-icon { display:grid; place-items:center; flex:0 0 16px; width:16px; height:16px; font:700 15px/1 system-ui,-apple-system,sans-serif; }
      .status-text { display:block; line-height:20px; }
      .status[data-state="waiting"] .status-icon::before { content:'·'; font-size:18px; }
      .status[data-state="loading"] .status-icon { box-sizing:border-box; border:2px solid currentColor; border-top-color:transparent; border-radius:50%; animation:status-spin .8s linear infinite; }
      .status[data-state="success"] .status-icon::before { content:'✓'; }
      .status[data-state="error"] .status-icon::before { content:'×'; }
      @keyframes status-spin { to { transform:rotate(360deg); } }
      @media (prefers-reduced-motion:reduce) { .status[data-state="loading"] .status-icon { animation:none; } }
      .result { margin:12px 0 0; border-top:1px solid #e2e8f0; padding-top:12px; overflow-wrap:anywhere; user-select:text; }
      .result > :first-child { margin-top:0; }
      .result > :last-child { margin-bottom:0; }
      .result p, .result ul, .result ol, .result blockquote, .result pre { margin:0 0 8px; }
      .result ul, .result ol { padding-left:22px; }
      .result h1, .result h2, .result h3 { margin:10px 0 6px; font-size:1.08em; line-height:1.4; }
      .result blockquote { padding-left:10px; border-left:3px solid #cbd5e1; color:#475569; }
      .result pre { overflow:auto; padding:9px 11px; border-radius:5px; background:#f1f5f9; white-space:pre; }
      .result code { font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .result :not(pre) > code { padding:1px 3px; border-radius:3px; background:#f1f5f9; }
      .result a { color:#066fd1; }
    `;
    shadow.append(style);
    const panel = document.createElement('section');
    panel.className = 'panel';
    const top = document.createElement('div');
    top.className = 'top';
    const actions = document.createElement('div');
    actions.className = 'actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '分析错误';
    const status = document.createElement('span');
    status.className = 'status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.hidden = true;
    const statusIcon = document.createElement('span');
    statusIcon.className = 'status-icon';
    statusIcon.setAttribute('aria-hidden', 'true');
    const statusText = document.createElement('span');
    statusText.className = 'status-text';
    status.append(statusIcon, statusText);
    function setStatus(state, message = '') {
      status.dataset.state = state;
      statusText.textContent = message;
      status.hidden = !message;
    }
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'settings';
    settings.setAttribute('aria-label', '接口设置');
    settings.title = '接口设置';
    settings.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h9m4 0h3M4 17h3m4 0h9"></path><circle cx="15" cy="7" r="2"></circle><circle cx="9" cy="17" r="2"></circle></svg>';
    settings.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }, response => {
        if (chrome.runtime.lastError || !response?.ok) {
          setStatus('error', `无法打开接口设置：${chrome.runtime.lastError?.message || response?.error || '未知错误。'}`);
        }
      });
    });
    actions.append(button, status);
    top.append(actions, settings);
    const result = document.createElement('div');
    result.className = 'result';
    result.hidden = true;
    let activePort;
    let heartbeat;
    let scheduledFrame;
    let answer = '';
    let analysisStarted = false;
    let verdictStatus = report.status;
    let verdictVersion = 0;
    function restoreCachedResult() {
      if (analysisStarted || verdictStatus === 'AC' || verdictStatus === 'PENDING') return;
      const currentVersion = verdictVersion;
      chrome.runtime.sendMessage({ type: 'GET_CACHED_RESULT' }, response => {
        if (analysisStarted || currentVersion !== verdictVersion ||
          verdictStatus === 'AC' || verdictStatus === 'PENDING' || chrome.runtime.lastError ||
          !response?.ok || typeof response.answer !== 'string' || !response.answer.trim()) return;
        answer = response.answer;
        render();
        button.textContent = '重新分析';
        setStatus('success', '已恢复上次分析');
      });
    }
    function render() {
      scheduledFrame = null;
      try { result.innerHTML = markdown.render(answer); }
      catch { result.textContent = answer; }
      result.hidden = !answer;
    }
    function scheduleRender() {
      if (scheduledFrame != null) return;
      scheduledFrame = requestAnimationFrame(render);
    }
    function finish(state, message) {
      clearInterval(heartbeat);
      heartbeat = null;
      activePort = null;
      if (scheduledFrame != null) cancelAnimationFrame(scheduledFrame);
      render();
      button.disabled = false;
      button.textContent = '重新分析';
      setStatus(state, message);
    }
    function updateVerdict(nextStatus) {
      if (nextStatus === verdictStatus) return;
      verdictStatus = nextStatus;
      verdictVersion++;
      clearInterval(heartbeat);
      heartbeat = null;
      if (activePort) {
        const port = activePort;
        activePort = null;
        port.disconnect();
      }
      if (scheduledFrame != null) cancelAnimationFrame(scheduledFrame);
      scheduledFrame = null;
      answer = '';
      result.textContent = '';
      result.hidden = true;
      button.textContent = '分析错误';
      if (nextStatus === 'AC') {
        button.disabled = true;
        setStatus('success', '恭喜，成功 AC 这道题');
      } else if (nextStatus === 'PENDING') {
        button.disabled = true;
        setStatus('waiting', '等待评测');
      } else {
        button.disabled = false;
        setStatus('idle');
        restoreCachedResult();
      }
    }
    if (report.status === 'AC') {
      button.disabled = true;
      setStatus('success', '恭喜，成功 AC 这道题');
    } else if (report.status === 'PENDING') {
      button.disabled = true;
      setStatus('waiting', '等待评测');
    }
    button.addEventListener('click', async () => {
      const latest = core.extractSubmission(document, location.href);
      if (!latest || latest.status === 'AC' || latest.status === 'PENDING') {
        if (latest) updateVerdict(latest.status);
        if (latest?.status === 'AC') return;
        setStatus('error', '当前没有可分析的失败结果，请等待评测完成或刷新页面。');
        return;
      }
      updateVerdict(latest.status);
      const currentVersion = verdictVersion;
      analysisStarted = true;
      button.disabled = true;
      setStatus('loading', '正在获取题面…');
      answer = '';
      result.hidden = true;
      const url = core.problemUrl(document, location.href);
      if (!url) { finish('error', '无法定位对应题面，请刷新提交页面后重试。'); return; }
      let problem;
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok || !response.url || new URL(response.url).href !== url) {
          throw new Error('题面页面不可用或登录已失效。');
        }
        problem = core.extractProblem(new DOMParser().parseFromString(await response.text(), 'text/html'));
        if (!problem) throw new Error('题面页面中未找到正文。');
      } catch (error) {
        if (currentVersion !== verdictVersion) return;
        finish('error', `无法获取题面：${error.message || '请求失败。'}请刷新页面或重新登录后重试。`);
        return;
      }
      if (currentVersion !== verdictVersion) return;
      const prompt = core.buildPrompt(latest, problem);
      if (!prompt) { finish('error', '无法生成分析内容，请刷新页面后重试。'); return; }
      setStatus('loading', '正在分析…');
      let port;
      try { port = chrome.runtime.connect({ name: 'NEUOJ_ANALYZE' }); }
      catch (error) { finish('error', error.message || '无法连接扩展后台。'); return; }
      activePort = port;
      let completed = false;
      port.onMessage.addListener(message => {
        if (currentVersion !== verdictVersion) return;
        if (message?.type === 'DELTA' && typeof message.text === 'string') {
          answer += message.text;
          scheduleRender();
        } else if (message?.type === 'DONE') {
          completed = true;
          finish('success', '分析完成');
        } else if (message?.type === 'ERROR') {
          completed = true;
          finish('error', message.error || '未知错误。');
        }
      });
      port.onDisconnect.addListener(() => {
        if (currentVersion === verdictVersion && !completed && activePort === port) finish('error', '与扩展后台的连接已中断。');
      });
      heartbeat = setInterval(() => {
        try { port.postMessage({ type: 'PING' }); } catch { /* 断线由 onDisconnect 处理。 */ }
      }, 20000);
      try { port.postMessage({ type: 'ANALYZE', prompt }); }
      catch (error) { completed = true; port.disconnect(); finish('error', error.message || '无法发送分析请求。'); }
    });
    panel.append(top, result);
    shadow.append(panel);
    const target = document.getElementById('tabs-source-code')?.closest('.tab-content') || document.getElementById('tabs-source-code');
    target?.parentElement?.insertBefore(host, target);
    mounted = !!host.isConnected;
    if (mounted) {
      const verdictObserver = new MutationObserver(() => {
        const latest = core.extractSubmission(document, location.href);
        if (latest) updateVerdict(latest.status);
      });
      for (const id of ['tabs-testcase-judging', 'tabs-compile-info']) {
        verdictObserver.observe(document.getElementById(id), { childList: true, subtree: true, characterData: true });
      }
    }
    if (mounted) restoreCachedResult();
    return mounted;
  }

  if (!mount()) {
    observer = new MutationObserver(() => { if (mount()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer?.disconnect(), 30000);
  }
})();
