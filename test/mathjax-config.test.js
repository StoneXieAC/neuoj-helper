const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const extensionDir = path.join(__dirname, '../extension');

test('真实 MathJax 在全局对象分离与相同时使用配置并加载本地安全模块和字体', async t => {
  for (const separated of [true, false]) {
    const dom = new JSDOM('<!doctype html><body></body>', {
      runScripts: 'outside-only', url: 'https://oj.neu.edu.cn/submissions/123'
    });
    t.after(() => dom.window.close());
    const context = dom.getInternalVMContext();
    if (separated) context.globalThis = Object.create(dom.window);
    context.chrome = { runtime: { getURL: file => `moz-extension://test/${file}` } };
    const run = file => vm.runInContext(fs.readFileSync(path.join(extensionDir, file), 'utf8'), context);
    run('src/mathjax-config.js');
    assert.equal(vm.runInContext('globalThis.MathJax === window.MathJax', context), true);
    if (separated) assert.equal(Object.hasOwn(context.globalThis, 'MathJax'), false);
    const loaded = [];
    // 在 Node 中执行打包模块，避免依赖浏览器的 moz-extension 动态导入器。
    context.window.MathJax.loader.require = file => {
      assert.ok(file.startsWith('moz-extension://test/vendor/'));
      loaded.push(file);
      run(file.slice('moz-extension://test/'.length));
      return Promise.resolve();
    };
    run('vendor/mathjax/tex-svg.js');
    const mathjax = context.window.MathJax;
    await mathjax.startup.promise;
    assert.equal(mathjax.config.startup.typeset, false);
    assert.equal(mathjax.config.options.safeOptions.allow.URLs, 'none');
    for (const tex of ['m', 'n', 'C(n+m-1,m)', '10^9+7', '(n-1)\\cdot(m+1)', '\\mathbb{R}']) {
      const node = await mathjax.tex2svgPromise(tex);
      assert.ok(node.querySelector('svg'));
      assert.equal(node.querySelector('[data-mml-node="merror"]'), null);
    }
    assert.ok(loaded.some(file => file.endsWith('/ui/safe.js')));
    assert.ok(loaded.some(file => file.includes('/mathjax-newcm-font/svg/dynamic/')));
  }
});
