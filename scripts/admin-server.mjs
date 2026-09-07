import { spawn } from 'node:child_process';

const watch = process.argv.includes('--watch');
const args = watch ? ['--watch', '--watch-preserve-output', 'server.js'] : ['server.js'];
const child = spawn(process.execPath, args, {
  env: {...process.env, ADMIN_ENABLED: '1'},
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
