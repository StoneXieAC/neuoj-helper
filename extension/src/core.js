(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.NEUOJCore = core;
})(globalThis, function () {
  'use strict';

  const TRUNCATED = '[内容过长，已截断]';
  const DEFAULTS = Object.freeze({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' });
  const MAX_PROMPT = 24000;
  const VPN_PREFIX = '/https/62304135386136393339346365373340bfebea318fd008d8f60d257088';

  function submissionPath(raw) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      let path = url.pathname;
      if (url.hostname === 'webvpn.neu.edu.cn') {
        if (!path.startsWith(`${VPN_PREFIX}/`)) return null;
        path = path.slice(VPN_PREFIX.length);
      } else if (url.hostname !== 'oj.neu.edu.cn') return null;
      return /(?:^|\/)submissions?\/\d+\/?$/.test(path) ? path : null;
    } catch { return null; }
  }

  function isSubmissionUrl(raw) {
    return submissionPath(raw) !== null;
  }

  function isSubmissionPage(doc, raw) {
    return isSubmissionUrl(raw) && ['tabs-source-code', 'tabs-compile-info', 'tabs-testcase-judging']
      .every(id => doc.getElementById(id));
  }

  function problemUrl(doc, submissionUrl) {
    const path = submissionPath(submissionUrl);
    if (!path) return null;
    const submission = new URL(submissionUrl);
    const base = submission.pathname.replace(/\/submissions?\/\d+\/?$/, '');
    let problemPath;
    if (/^\/submissions?\/\d+\/?$/.test(path)) problemPath = /^\/problems\/\d+\/?$/;
    else if (/^\/training\/\d+\/submissions?\/\d+\/?$/.test(path)) problemPath = /^\/part\/\d+\/problem\/\d+\/?$/;
    else if (/^\/contest\/\d+\/submissions?\/\d+\/?$/.test(path)) problemPath = /^\/problem\/\d+\/?$/;
    else problemPath = /(?:^|\/)problem\/\d+\/?$/;
    for (const link of doc.querySelectorAll('a[href]')) {
      if (link.textContent.trim() !== '返回题目') continue;
      try {
        const target = new URL(link.getAttribute('href'), submission);
        if (target.origin !== submission.origin || target.username || target.password) continue;
        if (!target.pathname.startsWith(`${base}/`)) continue;
        const relative = target.pathname.slice(base.length);
        if (!problemPath.test(relative)) continue;
        target.hash = '';
        return target.href;
      } catch { /* 忽略无效链接。 */ }
    }
    return null;
  }

  function clean(value) {
    return String(value || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  }

  function nodeText(node) {
    if (!node) return '';
    const parts = [];
    function walk(current) {
      if (current.nodeType === 3) { parts.push(current.nodeValue); return; }
      if (current.nodeType !== 1) return;
      const tag = current.tagName.toLowerCase();
      if (tag === 'br') { parts.push('\n'); return; }
      if (tag === 'script' || tag === 'style' || tag === 'button') return;
      for (const child of current.childNodes) walk(child);
      if (['p', 'li', 'pre', 'tr'].includes(tag)) parts.push('\n');
    }
    walk(node);
    return clean(parts.join(''));
  }

  function problemText(node) {
    if (!node) return '';
    const parts = [];
    function walk(current) {
      if (current.nodeType === 3) { parts.push(current.nodeValue); return; }
      if (current.nodeType !== 1) return;
      const tag = current.tagName.toLowerCase();
      if (['script', 'style', 'button', 'svg'].includes(tag)) return;
      if (current.hasAttribute('data-math')) {
        parts.push(` $${current.getAttribute('data-math').trim()}$ `);
        return;
      }
      if (tag === 'br') { parts.push('\n'); return; }
      if (tag === 'li') parts.push('\n- ');
      if (tag === 'pre') { parts.push('\n```\n', current.textContent, '\n```\n'); return; }
      let hasCell = false;
      for (const child of current.childNodes) {
        if (tag === 'tr' && child.nodeType === 1 && ['th', 'td'].includes(child.tagName.toLowerCase())) {
          if (hasCell) parts.push(' | ');
          hasCell = true;
        }
        walk(child);
      }
      if (['p', 'li', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'tr'].includes(tag)) parts.push('\n');
    }
    walk(node);
    let inCode = false;
    let blanks = 0;
    const lines = [];
    for (const line of clean(parts.join('')).split('\n')) {
      if (line === '```') { inCode = !inCode; blanks = 0; lines.push(line); continue; }
      const value = inCode ? line : line.replace(/[ \t]+/g, ' ').trim();
      if (!inCode && !value) {
        if (blanks++) continue;
      } else blanks = 0;
      lines.push(value);
    }
    return lines.join('\n');
  }

  function extractProblem(doc) {
    const content = doc.getElementById('problem-content-vditor');
    const body = problemText(content);
    if (!body) return null;
    const column = content.closest('.col-7');
    const title = clean(column?.querySelector('.card.mb-2 .card-header .nav-link strong')?.textContent);
    return { title, body, inputExample: problemText(doc.getElementById('example-input')),
      outputExample: problemText(doc.getElementById('example-output')) };
  }

  function codeText(node) {
    if (!node) return '';
    const rows = [...node.querySelectorAll('td.hljs-ln-code')];
    if (rows.length) return rows.map(row => row.textContent.replace(/\u00a0/g, ' ')).join('\n').trim();
    return nodeText(node.querySelector('pre code, pre'));
  }

  function classify(text) {
    const value = clean(text).toLowerCase();
    if (/编译(?:错误|失败|出错)|compilation error|compile error|(^|\W)ce(\W|$)/i.test(value)) return 'CE';
    if (/运行(?:时)?错误|运行异常|runtime error|(^|\W)re(\W|$)/i.test(value)) return 'RE';
    if (/时间超限|运行超时|time limit exceeded|(^|\W)tle(\W|$)/i.test(value)) return 'TLE';
    if (/内存超限|memory limit exceeded|(^|\W)mle(\W|$)/i.test(value)) return 'MLE';
    if (/输出超限|output limit exceeded|(^|\W)ole(\W|$)/i.test(value)) return 'OLE';
    if (/答案错误|wrong answer|(^|\W)wa(\W|$)/i.test(value)) return 'WA';
    if (/答案正确|accepted|(^|\W)ac(\W|$)/i.test(value)) return 'AC';
    return 'UNKNOWN';
  }

  function modalBody(doc, id) {
    return nodeText(doc.getElementById(id)?.querySelector('.modal-body'));
  }

  function modalRawBody(doc, id) {
    const body = doc.getElementById(id)?.querySelector('.modal-body');
    if (!body) return '';
    const parts = [];
    function walk(node) {
      if (node.nodeType === 3) { parts.push(node.nodeValue); return; }
      if (node.nodeType !== 1) return;
      if (node.tagName.toLowerCase() === 'br') { parts.push('\n'); return; }
      for (const child of node.childNodes) walk(child);
    }
    walk(body);
    return parts.join('').replace(/\r\n?/g, '\n');
  }

  function caseHeading(systemModal) {
    let parent = systemModal.parentElement;
    for (let level = 0; parent && level < 4; level++, parent = parent.parentElement) {
      for (const child of parent.children) {
        if (child === systemModal || child.contains(systemModal)) continue;
        const heading = nodeText(child);
        if (/#\s*\d{1,4}\s/.test(heading)) return heading;
      }
    }
    return '';
  }

  function parseDiff(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const sections = { expected: [], actual: [], detail: [] };
    let section = 'detail';
    let expectedPresent = false;
    let actualPresent = false;
    for (const line of lines) {
      const label = /^[ \t]*(judge|jury|team|him)[ \t]*:[ \t]?/i.exec(line);
      if (label) {
        section = /^(?:judge|jury)$/i.test(label[1]) ? 'expected' : 'actual';
        if (section === 'expected') expectedPresent = true;
        else actualPresent = true;
      }
      sections[section].push(label ? line.slice(label[0].length) : line);
    }
    return { expected: sections.expected.join('\n'), actual: sections.actual.join('\n'),
      detail: sections.detail.join('\n').trim(), expectedPresent, actualPresent };
  }

  function usefulSystem(text, status = '') {
    const lines = clean(text).split('\n');
    const useful = /^(?:exitcode|exit-code|signal|stderr|exception|error|message|output-truncated|time-result|memory-result|killed|status|reason)\s*:/i;
    const time = /^(?:wall-time|cpu-time|user-time|sys-time)\s*:/i;
    const memory = /^memory-bytes\s*:/i;
    const output = [];
    let inStderr = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const keyValue = /^[a-z][\w-]*\s*:/i.test(line);
      if (keyValue && !/^stderr\s*:/i.test(line)) inStderr = false;
      if (useful.test(line) && !/^(?:output-truncated|time-result|memory-result)\s*:\s*$/i.test(line)) {
        output.push(line);
        if (/^stderr\s*:/i.test(line)) inStderr = true;
      } else if (inStderr && !keyValue) output.push(line);
      else if (status === 'TLE' && time.test(line)) output.push(line);
      else if (status === 'MLE' && memory.test(line)) output.push(line);
      else if (!keyValue && /runtime error|segmentation fault|exception|signal|killed|time limit|memory limit|运行错误|超限/i.test(line)) output.push(line);
    }
    return output.join('\n');
  }

  function extractSubmission(doc, rawUrl) {
    if (!isSubmissionPage(doc, rawUrl)) return null;
    const sourcePane = doc.getElementById('tabs-source-code');
    const clip = sourcePane.querySelector('[data-clipboard-text]')?.getAttribute('data-clipboard-text');
    const source = clean(clip || codeText(sourcePane));
    const compilePane = doc.getElementById('tabs-compile-info');
    const compileLabel = nodeText(compilePane.querySelector('.card-header'));
    const compileRaw = codeText(compilePane.querySelector('#output_compile'));
    const compileHasError = classify(compileLabel) === 'CE' || /(?:^|\n).*?(?:fatal error:|error:|编译错误|编译失败|编译出错)/im.test(compileRaw);
    const compile = { label: compileLabel, errors: compileHasError ? compileRaw : '' };
    const cases = [];
    const pane = doc.getElementById('tabs-testcase-judging');
    for (const systemModal of pane.querySelectorAll('[id^="show_output_system"]')) {
      const match = /^show_output_system(\d+)$/.exec(systemModal.id);
      if (!match) continue;
      const suffix = match[1];
      const heading = caseHeading(systemModal);
      const status = classify(heading);
      const diffRaw = modalRawBody(doc, `show_output_diff${suffix}`);
      const error = modalBody(doc, `show_output_error${suffix}`);
      const system = usefulSystem(nodeText(systemModal.querySelector('.modal-body')), status);
      const inputMatch = [diffRaw, error].join('\n').match(/(?:^|\n)\s*(?:Input|输入|stdin)\s*:\s*([^\n]+)/i);
      cases.push({ index: Number(suffix) + 1, heading, status, diff: parseDiff(diffRaw), error,
        system: status === 'RE' || status === 'TLE' || status === 'MLE' || status === 'OLE' ? system : '',
        input: inputMatch ? inputMatch[1] : '' });
    }
    const failed = cases.filter(item => item.status !== 'AC' && item.status !== 'UNKNOWN');
    const kinds = [...new Set(failed.map(item => item.status))];
    let status = 'UNKNOWN';
    if (compileHasError) status = 'CE';
    else if (kinds.length === 1) status = kinds[0];
    else if (kinds.length > 1) status = 'MIXED';
    else if (cases.length && cases.every(item => item.status === 'AC')) status = 'AC';
    else if ([compileLabel, ...cases.map(item => item.heading)]
      .some(text => /等待评测|评测中|正在评测|排队中|pending|judging|running/i.test(text))) status = 'PENDING';
    return { status, source, compile, cases, url: rawUrl };
  }

  function bounded(value, max, focus = -1, preserve = false) {
    const text = preserve ? String(value ?? '') : clean(value);
    if (text.length <= max) return text;
    const marker = `\n${TRUNCATED}\n`;
    if (focus >= 0) {
      const room = Math.max(0, max - 2 * marker.length);
      const start = Math.max(0, Math.min(text.length - room, focus - Math.floor(room / 2)));
      return `${start ? marker : ''}${text.slice(start, start + room)}${start + room < text.length ? marker : ''}`;
    }
    const room = Math.max(0, max - marker.length);
    const head = Math.ceil(room * 0.65);
    return text.slice(0, head) + marker + text.slice(-(room - head));
  }

  function firstDifference(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
    return n;
  }

  function selectCases(cases) {
    const failed = cases.filter(item => item.status !== 'AC' && item.status !== 'UNKNOWN');
    const chosen = [];
    const signatures = new Set();
    for (const item of failed) {
      const signature = `${item.status}:${item.diff.detail.split('\n')[0] || item.error.split('\n')[0]}`;
      if (!signatures.has(signature)) { chosen.push(item); signatures.add(signature); }
      if (chosen.length === 4) return chosen;
    }
    for (const item of failed) {
      if (!chosen.includes(item)) chosen.push(item);
      if (chosen.length === 4) break;
    }
    return chosen;
  }

  function sourceExcerpt(source, diagnostic) {
    if (source.length <= 12000) return source;
    const lineNumber = Number((diagnostic.match(/(?:^|\n)[^\n]*?:(\d+):(\d+):\s*(?:fatal error|error)/im) || [])[1]);
    if (!lineNumber) return bounded(source, 12000);
    const lines = source.split('\n');
    const before = lines.slice(0, 50).join('\n');
    const nearby = lines.slice(Math.max(0, lineNumber - 31), lineNumber + 30).join('\n');
    const after = lines.slice(-50).join('\n');
    return bounded([before, TRUNCATED, nearby, TRUNCATED, after].join('\n'), 12000);
  }

  function buildPrompt(report, problem) {
    if (!report || ['AC', 'PENDING', 'UNKNOWN'].includes(report.status)) return null;
    const intro = `提交状态：${report.status}`;
    const sections = [intro];
    let remaining = MAX_PROMPT - intro.length - 30;
    function add(title, value, limit, preserve = false) {
      if (!value || remaining < 100) return;
      const capped = bounded(value, Math.min(limit, remaining - title.length - 4), -1, preserve);
      sections.push(`${title}\n${capped}`);
      remaining -= title.length + capped.length + 3;
    }
    if (problem?.body) {
      const title = problem.title ? `题目：${bounded(problem.title, 200)}\n` : '';
      const example = [problem.inputExample && `输入样例：\n${bounded(problem.inputExample, 1000)}`,
        problem.outputExample && `输出样例：\n${bounded(problem.outputExample, 1000)}`].filter(Boolean).join('\n');
      add('【题面】', `${title}${bounded(problem.body, 4500)}${example ? `\n${example}` : ''}`, 6700);
    }
    const selected = selectCases(report.cases);
    const caseBlocks = selected.map(item => {
      const fields = [`测试点 #${String(item.index).padStart(3, '0')}：${item.heading || item.status}`];
      if (item.input) fields.push(`输入：${bounded(item.input, 1200)}`);
      if (item.diff.detail) fields.push(`对比说明：${bounded(item.diff.detail, 1200)}`);
      if (item.diff.expectedPresent || item.diff.actualPresent || item.diff.expected || item.diff.actual) {
        const offset = firstDifference(item.diff.expected, item.diff.actual);
        if (item.diff.expectedPresent || item.diff.expected) fields.push(`标准答案：${bounded(item.diff.expected, 1200, offset, true)}`);
        if (item.diff.actualPresent || item.diff.actual) fields.push(`用户输出：${bounded(item.diff.actual, 1200, offset, true)}`);
        if ((item.diff.expectedPresent ?? !!item.diff.expected) && (item.diff.actualPresent ?? !!item.diff.actual) &&
          item.diff.expected !== item.diff.actual &&
          (/\s/.test(item.diff.expected[offset] || '') || /\s/.test(item.diff.actual[offset] || '') ||
            /^\s*$/.test(item.diff.expected.slice(offset)) || /^\s*$/.test(item.diff.actual.slice(offset)))) {
          const visible = value => bounded(value, 1200, offset, true).replace(/ /g, '␠').replace(/\t/g, '⇥').replace(/\n/g, '↵\n');
          fields.push(`空白差异标记（␠为空格，⇥为制表符，↵为换行）：\n标准答案：${visible(item.diff.expected)}\n用户输出：${visible(item.diff.actual)}`);
        }
      }
      if (item.error) fields.push(`错误详情：${bounded(item.error, 1800)}`);
      if (item.system) fields.push(`系统诊断：${bounded(item.system, 1200)}`);
      return fields.join('\n');
    });
    if (caseBlocks.length) add('【失败测试点】', caseBlocks.join('\n\n') + (report.cases.filter(item => item.status !== 'AC').length > selected.length ? `\n${TRUNCATED}（其余失败测试点未发送）` : ''), 7000, true);
    if (report.compile.errors) add('【编译错误】', report.compile.errors, 4000);
    add('【提交源码】', sourceExcerpt(report.source || '页面未提供', report.compile.errors || ''), 12000);
    const prompt = sections.join('\n\n');
    return prompt.length > MAX_PROMPT ? bounded(prompt, MAX_PROMPT) : prompt;
  }

  return { TRUNCATED, DEFAULTS, MAX_PROMPT, isSubmissionUrl, isSubmissionPage, problemUrl, extractProblem, extractSubmission,
    buildPrompt, classify, parseDiff, bounded, firstDifference, usefulSystem };
});
