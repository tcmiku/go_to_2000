import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

function invalid(message) {
  return Object.assign(new Error(message), { code: 'ADMIN_ACCOUNT_INVALID' });
}

async function readAccount(dataDir) {
  const accountPath = path.join(path.resolve(dataDir), '.private', 'account.json');
  let account;
  try {
    account = JSON.parse(await readFile(accountPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw invalid('尚未创建管理员账号，请先在后台完成初始化');
    if (error instanceof SyntaxError) throw invalid('管理员账号文件格式无效');
    throw error;
  }
  if (!account || typeof account !== 'object' || typeof account.username !== 'string' || !account.username.trim() ||
      typeof account.salt !== 'string' || !/^[a-f0-9]+$/i.test(account.salt) ||
      typeof account.hash !== 'string' || !/^[a-f0-9]{128}$/i.test(account.hash)) throw invalid('管理员账号文件格式无效');
  return { account, accountPath };
}

/** Check a candidate password without exposing the stored hash or password. */
export async function verifyAdminPassword({ dataDir, password }) {
  const { account } = await readAccount(dataDir);
  if (typeof password !== 'string' || password.length > 200) return { username: account.username, matches: false };
  const hash = await scrypt(password, account.salt, 64);
  return { username: account.username, matches: timingSafeEqual(hash, Buffer.from(account.hash, 'hex')) };
}

/** Replace the administrator password without changing the username. */
export async function resetAdminPassword({ dataDir, password }) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) {
    throw invalid('新密码须为 10—200 位');
  }
  const { account, accountPath } = await readAccount(dataDir);
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  const privateDir = path.dirname(accountPath);
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const temporaryPath = `${accountPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(temporaryPath, JSON.stringify({ ...account, salt, hash }, null, 2) + '\n', { mode: 0o600 });
    await rename(temporaryPath, accountPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return { username: account.username };
}
