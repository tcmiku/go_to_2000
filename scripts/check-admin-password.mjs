#!/usr/bin/env node
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { verifyAdminPassword } from '../server/admin-account.js';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

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

function usage() {
  console.log('用法：npm run check-admin-password [-- --data-dir <目录>] [--password-stdin]');
  console.log('只报告密码是否匹配，不会显示密码、哈希或随机盐。');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] || '';
}

function hiddenQuestion() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => input.question('候选管理员密码：', value => { input.close(); resolve(value); }));
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); };
    const onData = chunk => {
      for (const char of String(chunk)) {
        if (char === '\u0003') { cleanup(); process.stdout.write('\n'); reject(new Error('已取消')); return; }
        if (char === '\r' || char === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); return; }
        if (char === '\u007f' || char === '\b') { if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        if (char >= ' ') { value += char; process.stdout.write('•'); }
      }
    };
    process.stdout.write('候选管理员密码：'); process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', onData);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { usage(); return; }
  const password = options.passwordStdin ? await readStdin() : await hiddenQuestion();
  const result = await verifyAdminPassword({ dataDir: options.dataDir, password });
  console.log(result.matches ? `管理员「${result.username}」密码匹配。` : '密码不匹配。');
  if (!result.matches) process.exitCode = 1;
}

main().catch(error => { console.error(`密码校验失败：${error.message}`); process.exitCode = 1; });
