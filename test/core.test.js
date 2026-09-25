const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const core = require('../extension/src/core.js');

const direct = 'https://oj.neu.edu.cn/training/8/submission/1716135';
const vpn = 'https://webvpn.neu.edu.cn/https/opaque-id/training/8/submission/1716135';
const directProblem = 'https://oj.neu.edu.cn/training/8/part/68/problem/286';
const vpnProblem = 'https://webvpn.neu.edu.cn/https/opaque-id/training/8/part/68/problem/286';
const directGeneral = 'https://oj.neu.edu.cn/submissions/1716650';
const vpnGeneral = 'https://webvpn.neu.edu.cn/https/opaque-id/submissions/1716650';
const directGeneralProblem = 'https://oj.neu.edu.cn/problems/43';
const vpnGeneralProblem = 'https://webvpn.neu.edu.cn/https/opaque-id/problems/43';

function caseHtml(index, status, diff = '', error = '', system = '') {
  return `<div class="card"><div class="card-body"><div>#${String(index).padStart(3, '0')} ${status}</div>
    <div id="show_output_system${index - 1}" class="modal"><div class="modal-body">${system}</div></div>
    <div id="show_output_diff${index - 1}" class="modal"><div class="modal-body">${diff}</div></div>
    <div id="show_output_error${index - 1}" class="modal"><div class="modal-body">${error}</div></div>
  </div></div>`;
}

function page({ source = 'int main() { return 0; }', compileLabel = '编译成功', compileText = '', cases = '' } = {}, url = direct) {
  const html = `<!doctype html><html><body>
    <div id="tabs-source-code"><button data-clipboard-text="${source.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">复制代码</button></div>
    <div id="tabs-compile-info"><div class="card-header">编译信息 ${compileLabel}</div><div id="output_compile"><pre><code>${compileText}</code></pre></div></div>
    <div id="tabs-testcase-judging">${cases}</div>
  </body></html>`;
  return new JSDOM(html, { url }).window.document;
}

test('仅识别两个允许域名下具有提交结构的页面', () => {
  const doc = page();
  assert.equal(core.isSubmissionPage(doc, direct), true);
  assert.equal(core.isSubmissionPage(doc, vpn), true);
  assert.equal(core.isSubmissionPage(doc, directGeneral), true);
  assert.equal(core.isSubmissionPage(doc, vpnGeneral), true);
  assert.equal(core.isSubmissionUrl('https://webvpn.neu.edu.cn/https/opaque-id/training/8/problems'), false);
  assert.equal(core.isSubmissionUrl('https://evil.example/training/8/submission/1716135'), false);
  assert.equal(core.isSubmissionUrl('https://webvpn.neu.edu.cn/other/training/8/submission/1716135'), false);
  assert.equal(core.isSubmissionUrl('https://oj.neu.edu.cn/other/submissions/1716650'), false);
  assert.equal(core.isSubmissionUrl('https://webvpn.neu.edu.cn/submissions/1716650'), false);
  doc.getElementById('tabs-source-code').remove();
  assert.equal(core.isSubmissionPage(doc, direct), false);
});

test('最小页面样例提取题目链接、标题、公式、约束和样例', () => {
  const submitted = new JSDOM(`<a href="${vpnProblem}">返回题目</a>`).window.document;
  const statement = new JSDOM('<div class="col-7"><div class="card mb-2"><div class="card-header"><a class="nav-link"><strong>求幂</strong></a></div></div><div id="problem-content-vditor"><p>计算 <span data-math="m^n">公式</span>。</p><p>Constraints: 1 到 10^9</p></div><div id="example-input">5 8</div><div id="example-output">390625</div></div>').window.document;
  assert.equal(core.problemUrl(submitted, vpn), vpnProblem);
  const problem = core.extractProblem(statement);
  assert.equal(problem.title, '求幂');
  assert.match(problem.body, /\$m\^n\$/);
  assert.match(problem.body, /Constraints/);
  assert.match(problem.body, /10\^9/);
  assert.equal(problem.inputExample, '5 8');
  assert.equal(problem.outputExample, '390625');
  assert.doesNotMatch(problem.body, /复制|提交答案|Vditor\.preview/);
  const report = { status: 'WA', source: 'int main() {}', compile: { errors: '' }, cases: [] };
  const prompt = core.buildPrompt(report, problem);
  assert.match(prompt, /【题面】[\s\S]*题目：求幂/);
  assert.match(prompt, /输入样例：[\s\S]*5 8/);
});

test('通用提交页从返回题目链接读取全局题目，并限制同源及代理前缀', () => {
  const doc = new JSDOM('<a>返回题目</a>').window.document;
  const link = doc.querySelector('a');
  for (const [submission, expected] of [[directGeneral, directGeneralProblem], [vpnGeneral, vpnGeneralProblem]]) {
    link.href = expected;
    assert.equal(core.problemUrl(doc, submission), expected);
  }
  link.href = `${directGeneralProblem}#content`;
  assert.equal(core.problemUrl(doc, directGeneral), directGeneralProblem);
  for (const bad of ['https://evil.example/problems/43',
    'https://webvpn.neu.edu.cn/https/other-id/problems/43',
    'https://webvpn.neu.edu.cn/problems/43',
    'https://webvpn.neu.edu.cn/https/opaque-id/problems/43/editorial',
    vpnProblem]) {
    link.href = bad;
    assert.equal(core.problemUrl(doc, vpnGeneral), null);
  }
});

test('通用页沿用源码、编译和测试点提取', () => {
  const doc = page({ source: 'int main() { return 1; }', cases: caseHtml(1, '答案错误', 'Judge: 2<br>Team: 1') }, vpnGeneral);
  const report = core.extractSubmission(doc, vpnGeneral);
  assert.equal(report.status, 'WA');
  assert.equal(report.source, 'int main() { return 1; }');
  assert.equal(report.cases[0].diff.expected, '2');
  assert.equal(report.cases[0].diff.actual, '1');
});

test('题目链接必须与提交页同源、同训练和同 WebVPN 代理前缀', () => {
  const doc = new JSDOM('<a>返回题目</a>').window.document;
  const link = doc.querySelector('a');
  for (const [submission, expected] of [[direct, directProblem], [vpn, vpnProblem]]) {
    link.href = expected;
    assert.equal(core.problemUrl(doc, submission), expected);
  }
  link.setAttribute('href', '/training/8/part/68/problem/286#content');
  assert.equal(core.problemUrl(doc, direct), directProblem);
  for (const bad of ['https://evil.example/training/8/part/68/problem/286',
    'https://webvpn.neu.edu.cn/https/other/training/8/part/68/problem/286',
    'https://webvpn.neu.edu.cn/https/opaque-id/training/9/part/68/problem/286',
    'https://webvpn.neu.edu.cn/https/opaque-id/training/8/part/68/problem/286/editorial']) {
    link.href = bad;
    assert.equal(core.problemUrl(doc, vpn), null);
  }
  assert.equal(core.problemUrl(doc, 'https://evil.example/submission/1'), null);
});

test('题面代码块保留缩进和空行，公式只读取一次', () => {
  const doc = new JSDOM('<div id="problem-content-vditor"><p>求 <span data-math="x^2"><span>x²</span></span></p><pre>if (x) {\n    run();\n\n    done();\n}</pre></div>').window.document;
  const body = core.extractProblem(doc).body;
  assert.match(body, /\$x\^2\$/);
  assert.doesNotMatch(body, /x²/);
  assert.match(body, /```\nif \(x\) \{\n    run\(\);\n\n    done\(\);\n\}/);
});

test('题面表格保留单元格边界和行边界', () => {
  const doc = new JSDOM('<div id="problem-content-vditor"><table><thead><tr><th>输入</th><th>输出</th></tr></thead><tbody><tr><td>1 2</td><td>3 4</td></tr></tbody></table></div>').window.document;
  const problem = core.extractProblem(doc);
  assert.equal(problem.body, '输入 | 输出\n1 2 | 3 4');
  const prompt = core.buildPrompt({ status: 'WA', source: 'int main() {}', compile: { errors: '' }, cases: [] }, problem);
  assert.match(prompt, /输入 \| 输出\n1 2 \| 3 4/);
});

test('超长题面保留截断标记、测试点证据和源码', () => {
  const report = core.extractSubmission(page({ cases: caseHtml(1, '答案错误', 'Judge: 42<br>Team: 24') }), direct);
  const prompt = core.buildPrompt(report, { title: '长题目', body: '要求'.repeat(10000),
    inputExample: '1', outputExample: '2' });
  assert.ok(prompt.length <= core.MAX_PROMPT);
  assert.match(prompt, /【题面】/);
  assert.match(prompt, /\[内容过长，已截断\]/);
  assert.match(prompt, /标准答案：42/);
  assert.match(prompt, /【提交源码】/);
});

test('隐藏的 WA 弹窗提取标准答案与用户输出，忽略编译警告及统计数据', () => {
  const doc = page({
    source: 'int main() { return 42; }',
    compileLabel: '编译警告',
    compileText: 'main.cpp:1: warning: unused variable',
    cases: caseHtml(1, '答案错误', 'Wrong answer on line 1<br>Judge: "123"<br>Team: "456"', '', 'memory-bytes: 3000<br>exitcode: 0')
  });
  const report = core.extractSubmission(doc, direct);
  assert.equal(report.status, 'WA');
  assert.equal(report.compile.errors, '');
  assert.equal(report.cases[0].diff.expected, '"123"');
  assert.equal(report.cases[0].diff.actual, '"456"');
  const prompt = core.buildPrompt(report);
  assert.match(prompt, /标准答案："123"/);
  assert.match(prompt, /用户输出："456"/);
  assert.doesNotMatch(prompt, /输入：页面未提供/);
  assert.doesNotMatch(prompt, /unused variable|memory-bytes/);
});

test('多行 Judge 和 Team 输出分别归属标准答案与用户输出', () => {
  const report = core.extractSubmission(page({ cases: caseHtml(1, '答案错误', 'Wrong answer on line 2<br>Judge: 1<br>2<br>Team: 1<br>3') }), direct);
  assert.deepEqual(report.cases[0].diff, { expected: '1\n2', actual: '1\n3', detail: 'Wrong answer on line 2' });
  const prompt = core.buildPrompt(report);
  assert.match(prompt, /对比说明：Wrong answer on line 2/);
  assert.match(prompt, /标准答案：1\n2\n用户输出：1\n3/);
  assert.doesNotMatch(prompt, /对比说明：[\s\S]*2\n3/);
});

test('Judge 和 Team 分别缺失时，不产生空白答案项', () => {
  const onlyJudge = core.extractSubmission(page({ cases: caseHtml(1, '答案错误', 'Judge: 42') }), direct);
  const judgePrompt = core.buildPrompt(onlyJudge);
  assert.match(judgePrompt, /标准答案：42/);
  assert.doesNotMatch(judgePrompt, /用户输出：/);

  const onlyTeam = core.extractSubmission(page({ cases: caseHtml(1, '答案错误', 'Team: 24') }), direct);
  const teamPrompt = core.buildPrompt(onlyTeam);
  assert.match(teamPrompt, /用户输出：24/);
  assert.doesNotMatch(teamPrompt, /标准答案：/);

  const neither = core.extractSubmission(page({ cases: caseHtml(1, '答案错误', 'Wrong answer on line 1') }), direct);
  const noDiffPrompt = core.buildPrompt(neither);
  assert.doesNotMatch(noDiffPrompt, /标准答案：|用户输出：|未提供 Judge|未提供 Team/);
});

test('兼容 jury/him 标记并跳过全 AC 提交', () => {
  assert.deepEqual(core.parseDiff('jury: 9\nhim: 7'), { expected: '9', actual: '7', detail: '' });
  const doc = page({ cases: caseHtml(1, '答案正确') + caseHtml(2, '答案正确') });
  const report = core.extractSubmission(doc, direct);
  assert.equal(report.status, 'AC');
  assert.equal(core.buildPrompt(report), null);
});

test('CE 只包含实际编译错误，未完成的结果不会发起分析', () => {
  const ce = core.extractSubmission(page({ compileLabel: '编译错误', compileText: 'main.cpp:3:2: error: expected expression' }), direct);
  assert.equal(ce.status, 'CE');
  assert.match(core.buildPrompt(ce), /expected expression/);
  const pending = core.extractSubmission(page({ compileLabel: '编译警告', compileText: 'warning: unused variable' }), direct);
  assert.equal(pending.status, 'PENDING');
  assert.equal(core.buildPrompt(pending), null);
});

test('RE、TLE、MLE 筛选诊断字段，并识别混合状态', () => {
  const cases = [
    caseHtml(1, '运行错误', '', 'Segmentation fault', 'memory-bytes: 1000<br>exitcode: 139<br>signal: SIGSEGV'),
    caseHtml(2, '运行超时', '', 'Time limit exceeded', 'cpu-time: 5<br>time-result: exceeded'),
    caseHtml(3, '内存超限', '', 'Memory limit exceeded', 'memory-bytes: 999999<br>memory-result: exceeded')
  ].join('');
  const report = core.extractSubmission(page({ cases }), vpn);
  assert.equal(report.status, 'MIXED');
  assert.deepEqual(report.cases.map(item => item.status), ['RE', 'TLE', 'MLE']);
  const prompt = core.buildPrompt(report);
  assert.match(prompt, /SIGSEGV/);
  assert.match(prompt, /Time limit exceeded/);
  assert.match(prompt, /Memory limit exceeded/);
  assert.match(prompt, /cpu-time: 5/);
  assert.match(prompt, /memory-bytes: 999999/);
  assert.doesNotMatch(prompt, /memory-bytes: 1000/);
});

test('差异窗口与总预算均标记截断，并保留差异附近内容', () => {
  const actual = 'A'.repeat(4000) + 'X' + 'B'.repeat(4000);
  const expected = 'A'.repeat(4000) + 'Y' + 'B'.repeat(4000);
  const report = {
    status: 'WA', source: 'int x;\n'.repeat(5000), compile: { errors: '' },
    cases: [{ index: 1, heading: '答案错误', status: 'WA', input: '', error: '', system: '',
      diff: { detail: 'tokens mismatch', expected, actual } }]
  };
  const prompt = core.buildPrompt(report);
  assert.ok(prompt.length <= core.MAX_PROMPT);
  assert.match(prompt, /Y/);
  assert.match(prompt, /X/);
  assert.match(prompt, /\[内容过长，已截断\]/);
  assert.ok((prompt.match(/\[内容过长，已截断\]/g) || []).length >= 2);
});
