const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildFirefox } = require('../scripts/build-firefox.js');

const sourceDir = path.join(__dirname, '../extension');

function filesIn(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.name !== '.DS_Store').flatMap(entry => {
    const name = path.join(prefix, entry.name);
    return entry.isDirectory() ? filesIn(path.join(dir, entry.name), name) : [name];
  }).sort();
}

test('Firefox 构建只替换清单并复制全部扩展文件', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'neuoj-firefox-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const outputDir = path.join(temporary, 'firefox');
  const sourceManifestText = fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8');
  buildFirefox(sourceDir, outputDir);

  const chromium = JSON.parse(sourceManifestText);
  const firefox = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
  assert.deepEqual(filesIn(outputDir), filesIn(sourceDir));
  for (const file of filesIn(sourceDir).filter(file => file !== 'manifest.json')) {
    assert.deepEqual(fs.readFileSync(path.join(outputDir, file)), fs.readFileSync(path.join(sourceDir, file)));
  }
  assert.equal(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'), sourceManifestText);
  assert.deepEqual(chromium.background, { service_worker: 'src/background.js' });
  assert.equal(chromium.minimum_chrome_version, '114');
  assert.deepEqual(firefox.background, { scripts: ['src/background.js'] });
  assert.equal(firefox.minimum_chrome_version, undefined);
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, '128.0');
  assert.equal(firefox.browser_specific_settings.gecko.id, 'neuoj-helper@local');
  assert.deepEqual(firefox.content_scripts, chromium.content_scripts);
  assert.deepEqual(firefox.optional_host_permissions, chromium.optional_host_permissions);
  assert.deepEqual(firefox.permissions, chromium.permissions);
});

test('公式脚本、样式和字体均随扩展分发并允许提交页加载', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.indexOf('vendor/katex/katex.min.js') < scripts.indexOf('vendor/texmath/texmath.js'));
  assert.ok(scripts.indexOf('vendor/texmath/texmath.js') < scripts.indexOf('src/content.js'));
  const accessible = manifest.web_accessible_resources[0];
  assert.deepEqual(accessible.matches, ['https://oj.neu.edu.cn/*', 'https://webvpn.neu.edu.cn/*']);
  for (const file of ['vendor/katex/katex.min.css', 'vendor/texmath/texmath.css']) {
    assert.ok(accessible.resources.includes(file));
    assert.ok(fs.existsSync(path.join(sourceDir, file)));
  }
  assert.ok(accessible.resources.includes('vendor/katex/fonts/*'));
  const css = fs.readFileSync(path.join(sourceDir, 'vendor/katex/katex.min.css'), 'utf8');
  for (const [, font] of css.matchAll(/url\((fonts\/[^)]+)\)/g)) {
    assert.ok(fs.existsSync(path.join(sourceDir, 'vendor/katex', font)), font);
  }
});
