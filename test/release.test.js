'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
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
  zip.addFile('manifest.json', Buffer.from('{}'));
  zip.writeZip(archive);
  assert.throws(() => verifyXpi(archive, source), /内容/);
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
