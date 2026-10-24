'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const { verifyXpi, authorization, existingVersion, withSigningSource } = require('../scripts/release.js');

test('XPI 核验拒绝无签名、内容变化、额外文件和重复文件', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuoj-xpi-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'manifest.json'), '{"version":"0.1.0"}');
  const archive = path.join(dir, 'signed.xpi');
  const zip = new AdmZip();
  zip.addLocalFolder(source);
  zip.writeZip(archive);
  assert.throws(() => verifyXpi(archive, source), /签名/);
  for (const file of ['manifest.mf', 'mozilla.sf', 'mozilla.rsa']) zip.addFile(`META-INF/${file}`, Buffer.from('签名样例'));
  zip.writeZip(archive);
  assert.equal(verifyXpi(archive, source), true);
  zip.addFile('manifest.json', Buffer.from('{\n  \"version\": \"0.1.0\"\n}\n'));
  zip.writeZip(archive);
  assert.equal(verifyXpi(archive, source), true);
  zip.addFile('manifest.json', Buffer.from('{}'));
  zip.writeZip(archive);
  assert.throws(() => verifyXpi(archive, source), /清单字段/);
  zip.addFile('manifest.json', fs.readFileSync(path.join(source, 'manifest.json')));
  zip.addFile('extra.js', Buffer.from('额外文件'));
  zip.writeZip(archive);
  assert.throws(() => verifyXpi(archive, source), /文件列表/);
  zip.deleteFile('extra.js');
  zip.addFile('duplicate.json', Buffer.from('{}'));
  zip.getEntry('duplicate.json').entryName = 'manifest.json';
  zip.writeZip(archive);
  assert.throws(() => verifyXpi(archive, source), /重复文件|Duplicate entry/);
});

test('Mozilla 查询区分首次签名、已有版本和鉴权失败', async () => {
  const headers = authorization('issuer', 'secret').slice(4).split('.');
  const claims = JSON.parse(Buffer.from(headers[1], 'base64url'));
  assert.equal(claims.iss, 'issuer');
  assert.equal(claims.exp - claims.iat, 60);
  assert.equal(headers[2], crypto.createHmac('sha256', 'secret').update(headers.slice(0, 2).join('.')).digest('base64url'));
  const url = 'https://addons.mozilla.org/api/v5/example/';
  assert.equal(await existingVersion(async () => ({ status: 404 }), url, 'issuer', 'secret'), null);
  const version = { version: '0.1.0', channel: 'unlisted' };
  assert.deepEqual(await existingVersion(async () => ({ ok: true, json: async () => version }), url, 'issuer', 'secret'), version);
  await assert.rejects(existingVersion(async () => ({ status: 401, ok: false }), url, 'issuer', 'secret'), /401/);
});

test('无签名凭据时发布命令失败', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/release.js'), 'sign'], {
    env: { ...process.env, WEB_EXT_API_KEY: '', WEB_EXT_API_SECRET: '' }, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少 Mozilla 签名凭据/);
});


test('首次签名写入的工具元数据不会污染构建，成功与失败均清理签名副本', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuoj-signing-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'firefox');
  const working = path.join(dir, 'signing-source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'manifest.json'), '{"version":"0.1.0"}');
  for (const fails of [false, true]) {
    const sign = () => withSigningSource(source, working, signingDir => {
      assert.equal(fs.readFileSync(path.join(signingDir, 'manifest.json'), 'utf8'), '{"version":"0.1.0"}');
      for (const name of ['.web-extension-id', '.amo-upload-uuid']) fs.writeFileSync(path.join(signingDir, name), '签名元数据');
      if (fails) throw new Error('签名失败');
      return '签名成功';
    });
    if (fails) assert.throws(sign, /签名失败/);
    else assert.equal(sign(), '签名成功');
    assert.deepEqual(fs.readdirSync(source), ['manifest.json']);
    assert.equal(fs.existsSync(working), false);
  }
});

test('正式版与预发布正确匹配发行标签和五个附件', t => {
  const { readReleaseVersions, checkReleaseTag, releaseAssetNames } = require('../scripts/versions');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuoj-versions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'extension'));
  fs.mkdirSync(path.join(root, 'clion-plugin'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.2.2' }));
  const lock = { version: '0.2.2', packages: { '': { version: '0.2.2' } } };
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  fs.writeFileSync(path.join(root, 'extension/manifest.json'), JSON.stringify({ version: '0.2.2', version_name: '0.2.2' }));
  fs.writeFileSync(path.join(root, 'clion-plugin/build.gradle.kts'), 'version = "0.2.2-beta"\n');
  const versions = readReleaseVersions(root);
  assert.deepEqual(versions, { web: '0.2.2', clion: '0.2.2-beta', tag: 'v0.2.2-beta' });
  checkReleaseTag('v0.2.2-beta', versions);
  assert.throws(() => checkReleaseTag('v0.2.2', versions), /发行标签/);
  assert.deepEqual(releaseAssetNames(versions), [
    'neuoj-helper-0.2.2-chrome.zip', 'neuoj-helper-0.2.2-firefox.xpi',
    'neuoj-clion-helper-0.2.2-beta-macos.zip', 'neuoj-clion-helper-0.2.2-beta-linux-x64.zip',
    'neuoj-clion-helper-0.2.2-beta-windows-x64.zip'
  ]);
  fs.writeFileSync(path.join(root, 'clion-plugin/build.gradle.kts'), 'version = "0.2.2"\n');
  const stable = readReleaseVersions(root);
  assert.deepEqual(stable, { web: '0.2.2', clion: '0.2.2', tag: 'v0.2.2' });
  checkReleaseTag('v0.2.2', stable);
  assert.throws(() => checkReleaseTag('v0.2.2-beta', stable), /发行标签/);
  assert.deepEqual(releaseAssetNames(stable), [
    'neuoj-helper-0.2.2-chrome.zip', 'neuoj-helper-0.2.2-firefox.xpi',
    'neuoj-clion-helper-0.2.2-macos.zip', 'neuoj-clion-helper-0.2.2-linux-x64.zip',
    'neuoj-clion-helper-0.2.2-windows-x64.zip'
  ]);
  fs.writeFileSync(path.join(root, 'clion-plugin/build.gradle.kts'), 'version = "0.2.3-beta"\n');
  assert.throws(() => readReleaseVersions(root), /版本字段/);
  fs.writeFileSync(path.join(root, 'clion-plugin/build.gradle.kts'), 'version = "0.2.2-beta"\n');
  lock.packages[''].version = '0.2.1';
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  assert.throws(() => readReleaseVersions(root), /版本字段/);
});

test('发布流程保留人工公告并正确设置正式版和预发布', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuoj-release-workflow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/release.yml'), 'utf8');
  const script = workflow.split('      - name: 发布 GitHub Release\n')[1]
    .split('        run: |\n')[1].replace(/^          /gm, '');
  for (const dir of ['bin', 'scripts', 'docs/releases', 'dist/releases']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  const log = path.join(root, 'gh.jsonl');
  fs.writeFileSync(path.join(root, 'bin/gh'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.NEUOJ_GH_LOG, JSON.stringify(args) + '\\n');
if (args[1] === 'view') process.exit(process.env.NEUOJ_RELEASE_EXISTS === 'true' ? 0 : 1);
`, { mode: 0o755 });
  for (const prerelease of [false, true]) {
    const version = prerelease ? '0.2.3-beta' : '0.2.3';
    const tag = `v${version}`;
    const notes = `docs/releases/${tag}.md`;
    fs.writeFileSync(path.join(root, 'scripts/versions.js'),
      `exports.readReleaseVersions = () => ({ web: '0.2.3', clion: '${version}' });\n`);
    for (const file of [
      'neuoj-helper-0.2.3-chrome.zip', 'neuoj-helper-0.2.3-firefox.xpi',
      ...['macos', 'linux-x64', 'windows-x64'].map(platform => `neuoj-clion-helper-${version}-${platform}.zip`)
    ]) fs.writeFileSync(path.join(root, 'dist/releases', file), 'fixture');
    for (const hasNotes of [false, true]) {
      if (hasNotes) fs.writeFileSync(path.join(root, notes), '人工发布公告\n');
      else fs.rmSync(path.join(root, notes), { force: true });
      for (const exists of [false, true]) {
        fs.writeFileSync(log, '');
        const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
          cwd: root, encoding: 'utf8',
          env: { ...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
            GITHUB_REF_NAME: tag, GITHUB_REPOSITORY: 'example/neuoj-helper',
            NEUOJ_GH_LOG: log, NEUOJ_RELEASE_EXISTS: String(exists) }
        });
        assert.equal(result.status, 0, result.stderr);
        const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
        const publish = calls.at(-1);
        assert.deepEqual(publish.slice(0, 3), ['release', exists ? 'edit' : 'create', tag]);
        assert.equal(publish.includes('--notes-file'), hasNotes);
        if (hasNotes) assert.equal(publish[publish.indexOf('--notes-file') + 1], notes);
        assert.equal(publish.includes('--generate-notes'), !exists && !hasNotes);
        assert.equal(publish.includes('--prerelease'), prerelease);
        assert.equal(publish.includes('--prerelease=false'), !prerelease);
        assert.equal(publish.includes('--latest'), !prerelease);
        const upload = exists ? calls.find(call => call[1] === 'upload') : publish;
        assert.equal(upload.filter(arg => arg.startsWith('dist/releases/')).length, 5);
      }
    }
  }
});
