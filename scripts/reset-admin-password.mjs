#!/usr/bin/env node
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resetAdminPassword } from '../server/admin-account.js';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

function usage() {
  console.log('用法：npm run reset-admin-password [-- --data-dir <目录>] [--password-stdin]');
  console.log('默认以隐藏输入提示新密码；--password-stdin 从标准输入读取两行密码。');
}

function parseArgs(args) {
  let dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
  let passwordStdin = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--help' || args[i] === '-h') return { help: true };
    if (args[i] === '--password-stdin') { passwordStdin = true; continue; }
    if (args[i] === '--data-dir') {
      if (!args[i + 1]) throw new Error('--data-dir 需要目录路径');
      dataDir = path.resolve(args[++i]);
      continue;
    }
    throw new Error(`未知参数：${args[i]}`);
  }
  return { dataDir, passwordStdin };
}

async function readPipedPasswords() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('--password-stdin 需要两行相同的新密码');
  if (lines[0] !== lines[1]) throw new Error('两次输入的新密码不一致');
  return lines[0];
}

function hiddenQuestion(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => input.question(`${label}：`, value => { input.close(); resolve(value); }));
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = chunk => {
      for (const char of String(chunk)) {
        if (char === '\u0003') { cleanup(); process.stdout.write('\n'); reject(new Error('已取消')); return; }
        if (char === '\r' || char === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); return; }
        if (char === '\u007f' || char === '\b') { if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        if (char >= ' ') { value += char; process.stdout.write('•'); }
      }
    };
    const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); };
    process.stdout.write(`${label}：`); process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', onData);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { usage(); return; }
  const password = options.passwordStdin ? await readPipedPasswords() : await hiddenQuestion('新管理员密码');
  const confirmation = options.passwordStdin ? password : await hiddenQuestion('再次输入新密码');
  if (password !== confirmation) throw new Error('两次输入的新密码不一致');
  const result = await resetAdminPassword({ dataDir: options.dataDir, password });
  console.log(`管理员「${result.username}」密码已重置。请重启服务使其生效，重启后现有会话需重新登录。`);
}

main().catch(error => { console.error(`密码重置失败：${error.message}`); process.exitCode = 1; });
