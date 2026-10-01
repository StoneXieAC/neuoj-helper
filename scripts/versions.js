'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

function readReleaseVersions(root = ROOT) {
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const web = read('package.json').version;
  const lock = read('package-lock.json');
  const manifest = read('extension/manifest.json');
  const clion = fs.readFileSync(path.join(root, 'clion-plugin/build.gradle.kts'), 'utf8')
    .match(/^version = "([^"]+)"$/m)?.[1];
  if (!/^\d+\.\d+\.\d+$/.test(web) || lock.version !== web || lock.packages?.['']?.version !== web ||
    manifest.version !== web || manifest.version_name !== web || !clion || clion.replace(/-.+$/, '') !== web) {
    throw new Error('Web 或 CLion 版本字段不一致。');
  }
  return { web, clion, tag: `v${clion}` };
}

function checkReleaseTag(tag, versions = readReleaseVersions()) {
  if (tag !== versions.tag) throw new Error('发行标签与 CLion 版本不一致。');
}

function releaseAssetNames(versions = readReleaseVersions()) {
  return [
    `neuoj-helper-${versions.web}-chrome.zip`,
    `neuoj-helper-${versions.web}-firefox.xpi`,
    ...['macos', 'linux-x64', 'windows-x64'].map(platform => `neuoj-clion-helper-${versions.clion}-${platform}.zip`)
  ];
}

if (require.main === module) {
  const versions = readReleaseVersions();
  if (process.argv[2]) checkReleaseTag(process.argv[2], versions);
  console.log(JSON.stringify(versions));
}

module.exports = { readReleaseVersions, checkReleaseTag, releaseAssetNames };
