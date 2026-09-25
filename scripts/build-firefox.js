'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function buildFirefox(sourceDir = path.join(ROOT, 'extension'), outputDir = path.join(ROOT, 'dist/firefox')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));
  const firefoxManifest = {
    ...manifest,
    background: { scripts: [manifest.background.service_worker] },
    browser_specific_settings: {
      gecko: { id: 'neuoj-helper@local', strict_min_version: '128.0' }
    }
  };
  delete firefoxManifest.minimum_chrome_version;

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, outputDir, {
    recursive: true,
    filter: source => path.basename(source) !== '.DS_Store'
  });
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(firefoxManifest, null, 2)}\n`);
  return outputDir;
}

if (require.main === module) {
  console.log(`Firefox 扩展已生成：${buildFirefox()}`);
}

module.exports = { buildFirefox };
