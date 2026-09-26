'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

function build(browser, sourceDir = path.join(ROOT, 'extension'), outputDir = path.join(ROOT, 'dist', browser)) {
  if (!['chrome', 'firefox'].includes(browser)) throw new Error('浏览器必须为 chrome 或 firefox。');
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));
  if (browser === 'firefox') {
    manifest.background = { scripts: [manifest.background.service_worker] };
    delete manifest.minimum_chrome_version;
    manifest.browser_specific_settings = {
      gecko: {
        id: 'neuoj-helper@stonexie',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['websiteContent', 'authenticationInfo'] }
      }
    };
  }
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, outputDir, {
    recursive: true,
    filter: source => path.basename(source) !== '.DS_Store'
  });
  if (browser === 'firefox') {
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return outputDir;
}

if (require.main === module) {
  try {
    if (process.argv.length > 3) throw new Error('最多指定一个浏览器参数。');
    for (const browser of process.argv[2] ? [process.argv[2]] : ['chrome', 'firefox']) {
      console.log(`扩展已生成：${build(browser)}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { build };
