'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { spawnSync } = require('node:child_process');
const AdmZip = require('adm-zip');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'dist/releases');
const manifest = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/firefox/manifest.json'), 'utf8'));

function filesIn(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.name !== '.DS_Store').flatMap(entry => {
    const name = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? filesIn(path.join(dir, entry.name), name) : [name];
  }).sort();
}

function verifyXpi(archivePath, sourceDir = path.join(ROOT, 'dist/firefox')) {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries().filter(entry => !entry.isDirectory);
  const names = entries.map(entry => entry.entryName);
  if (new Set(names).size !== names.length) throw new Error('XPI 包含重复文件。');
  for (const file of ['META-INF/manifest.mf', 'META-INF/mozilla.sf', 'META-INF/mozilla.rsa']) {
    if (!names.includes(file) || zip.readFile(file).length === 0) throw new Error('XPI 缺少 Mozilla 签名文件。');
  }
  const expected = filesIn(sourceDir);
  const actual = names.filter(name => !name.startsWith('META-INF/')).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('XPI 文件列表与构建不一致。');
  for (const name of expected) {
    const signed = zip.readFile(name);
    const built = fs.readFileSync(path.join(sourceDir, name));
    if (name === 'manifest.json') {
      let signedManifest;
      try {
        signedManifest = JSON.parse(signed.toString('utf8'));
      } catch {
        throw new Error('XPI 清单不是有效 JSON。');
      }
      if (!isDeepStrictEqual(signedManifest, JSON.parse(built.toString('utf8')))) {
        throw new Error(`XPI 清单字段与构建不一致：${JSON.stringify(signedManifest)}`);
      }
    } else if (!signed.equals(built)) {
      throw new Error(`XPI 内容与构建不一致：${name}`);
    }
  }
  return true;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败。`);
}

function packageChrome() {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  const zip = new AdmZip();
  const sourceDir = path.join(ROOT, 'dist/chrome');
  for (const file of filesIn(sourceDir)) zip.addFile(file, fs.readFileSync(path.join(sourceDir, file)));
  zip.writeZip(path.join(RELEASE_DIR, `neuoj-helper-${manifest().version_name || manifest().version}-chrome.zip`));
}

function withSigningSource(sourceDir, signingDir, action) {
  fs.rmSync(signingDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, signingDir, { recursive: true });
  try {
    return action(signingDir);
  } finally {
    fs.rmSync(signingDir, { recursive: true, force: true });
  }
}

function prepareSource() {
  const sourceDir = path.join(ROOT, 'dist/review-source');
  fs.rmSync(sourceDir, { recursive: true, force: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  for (const name of ['extension', 'scripts', 'package.json', 'package-lock.json', 'README.md', 'docs']) {
    fs.cpSync(path.join(ROOT, name), path.join(sourceDir, name), { recursive: true, filter: file => path.basename(file) !== '.DS_Store' });
  }
  for (const spec of ['markdown-it@15.0.2', 'markdown-it-texmath@1.0.0', '@mathjax/src@4.1.3', '@mathjax/mathjax-newcm-font@4.1.3']) {
    const result = spawnSync('npm', ['pack', spec, '--json', '--pack-destination', sourceDir], { cwd: ROOT, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`无法取得审核源码：${spec}`);
    const packed = JSON.parse(result.stdout);
    const metadata = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
    if (!metadata?.filename) throw new Error(`npm 未返回源码文件：${spec}`);
    const archive = path.join(sourceDir, metadata.filename);
    const dest = path.join(sourceDir, 'third-party-source', spec.replace(/[^a-zA-Z0-9.-]/g, '_'));
    fs.mkdirSync(dest, { recursive: true });
    run('tar', ['-xzf', archive, '--strip-components=1', '-C', dest]);
    fs.rmSync(archive);
  }
  const zip = new AdmZip();
  for (const file of filesIn(sourceDir)) zip.addFile(file, fs.readFileSync(path.join(sourceDir, file)));
  const output = path.join(ROOT, 'dist/review-source.zip');
  zip.writeZip(output);
  fs.rmSync(sourceDir, { recursive: true, force: true });
  return output;
}

function authorization(key, secret) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: key, jti: crypto.randomUUID(), iat: now, exp: now + 60 })}`;
  return `JWT ${unsigned}.${crypto.createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

async function existingVersion(fetchFn, apiUrl, key, secret) {
  const response = await fetchFn(apiUrl, { headers: { Authorization: authorization(key, secret) }, signal: AbortSignal.timeout(60000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Mozilla 版本查询失败：HTTP ${response.status}`);
  return response.json();
}

async function signFirefox() {
  const key = process.env.WEB_EXT_API_KEY;
  const secret = process.env.WEB_EXT_API_SECRET;
  if (!key || !secret) throw new Error('缺少 Mozilla 签名凭据。');
  const current = manifest();
  const id = current.browser_specific_settings.gecko.id;
  const apiUrl = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(id)}/versions/${encodeURIComponent(current.version)}/`;
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  const output = path.join(RELEASE_DIR, `neuoj-helper-${current.version_name || current.version}-firefox.xpi`);
  fs.rmSync(output, { force: true });
  const previous = await existingVersion(fetch, apiUrl, key, secret);
  if (!previous) {
    const sourceArchive = prepareSource();
    withSigningSource(path.join(ROOT, 'dist/firefox'), path.join(ROOT, 'dist/signing-source'), signingDir => {
      run(process.execPath, [path.join(ROOT, 'node_modules/web-ext/bin/web-ext.js'), 'sign', '--source-dir', signingDir, '--artifacts-dir', 'dist/signed', '--channel', 'unlisted', '--upload-source-code', sourceArchive, '--approval-timeout', '900000', '--no-input']);
    });
  } else {
    console.log('Mozilla 已存在此版本，恢复签名结果。');
  }
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const version = await existingVersion(fetch, apiUrl, key, secret);
    if (version && (version.channel !== 'unlisted' || version.version !== current.version)) throw new Error('Mozilla 版本或分发渠道不匹配。');
    if (version?.is_disabled) throw new Error('Mozilla 版本已拒绝或停用。');
    if (version?.file?.status === 'public' && version.file.url) {
      const url = new URL(version.file.url);
      if (url.protocol !== 'https:') throw new Error('Mozilla 下载地址必须为 HTTPS。');
      const response = await fetch(url, {
        headers: url.origin === 'https://addons.mozilla.org' ? { Authorization: authorization(key, secret) } : {},
        signal: AbortSignal.timeout(60000)
      });
      if (!response.ok) throw new Error(`下载签名 XPI 失败：HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const expectedHash = version.file.hash;
      const actualHash = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
      if (expectedHash !== actualHash) throw new Error('XPI 与 Mozilla 发布摘要不一致。');
      fs.writeFileSync(output, bytes);
      verifyXpi(output);
      console.log('Firefox 已签名，且与当前构建内容一致。');
      return output;
    }
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  throw new Error('等待 Mozilla 签名超时，请检查 AMO 审核状态后重跑工作流。');
}

if (require.main === module) {
  (async () => {
    if (process.argv[2] === 'source') prepareSource();
    else if (process.argv[2] === 'package') packageChrome();
    else if (process.argv[2] === 'sign') await signFirefox();
    else throw new Error('请选择 package、source 或 sign。');
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { filesIn, verifyXpi, authorization, existingVersion, withSigningSource };
