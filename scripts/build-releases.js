'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildFirefox } = require('./build-firefox.js');

const ROOT = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')).version;

function filesIn(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.name !== '.DS_Store').flatMap(entry => {
    const name = path.join(prefix, entry.name);
    return entry.isDirectory() ? filesIn(path.join(dir, entry.name), name) : [name];
  }).sort();
}

function packageDirectory(sourceDir, archivePath) {
  const files = filesIn(sourceDir);
  fs.rmSync(archivePath, { force: true });
  const result = spawnSync('zip', ['-X', '-q', archivePath, ...files], { cwd: sourceDir, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`打包失败：${result.stderr.trim() || 'zip 未正常退出。'}`);
  return archivePath;
}

function buildReleases() {
  const firefoxDir = buildFirefox();
  const releaseDir = path.join(ROOT, 'dist/releases');
  fs.mkdirSync(releaseDir, { recursive: true });
  return [
    packageDirectory(path.join(ROOT, 'extension'), path.join(releaseDir, `neuoj-helper-${version}-chromium.zip`)),
    packageDirectory(firefoxDir, path.join(releaseDir, `neuoj-helper-${version}-firefox.zip`))
  ];
}

if (require.main === module) {
  for (const archive of buildReleases()) console.log(`已生成：${archive}`);
}

module.exports = { buildReleases };
