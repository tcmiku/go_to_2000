import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

function runCli(script, dataDir, input, extra = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--data-dir', dataDir, '--password-stdin', ...extra], { cwd: path.resolve('.'), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function seedData(dir) {
  const privateDir = path.join(dir, '.private');
  await mkdir(privateDir, { recursive: true });
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt('old-password-123', salt, 64)).toString('hex');
  await writeFile(path.join(privateDir, 'account.json'), JSON.stringify({ username: 'owner', salt, hash }));
}

test('command line resets the administrator password in the selected data directory', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'web-surfer-password-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await seedData(dir);
  const result = await runCli('scripts/reset-admin-password.mjs', dir, 'new-password-456\nnew-password-456\n');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /密码已重置/);
  const stored = JSON.parse(await readFile(path.join(dir, '.private/account.json'), 'utf8'));
  assert.equal(stored.username, 'owner');
  assert.equal(stored.password, undefined);
  const matched = await runCli('scripts/check-admin-password.mjs', dir, 'new-password-456\n');
  assert.equal(matched.code, 0);
  assert.match(matched.stdout, /密码匹配/);
  const rejected = await runCli('scripts/check-admin-password.mjs', dir, 'wrong-password-999\n');
  assert.equal(rejected.code, 1);
  assert.match(rejected.stdout, /不匹配/);
});

test('command line rejects mismatched piped passwords without changing the account', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'web-surfer-password-mismatch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await seedData(dir);
  const before = await readFile(path.join(dir, '.private/account.json'), 'utf8');
  const result = await runCli('scripts/reset-admin-password.mjs', dir, 'new-password-456\nother-password-789\n');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /不一致/);
  assert.equal(await readFile(path.join(dir, '.private/account.json'), 'utf8'), before);
});
