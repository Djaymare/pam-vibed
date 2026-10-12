// Disposable IPC fixture; no engine, audio file or user application is used.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const profile = process.argv[3];
const modeFile = path.join(profile, 'mode');
const mode = fs.readFileSync(modeFile, 'utf8').trim();
fs.writeFileSync(path.join(profile, 'started.json'), JSON.stringify({ pid: process.pid, mode }));
setInterval(() => {}, 1000);
if (mode === 'never-read-child') {
  const helper = require('node:child_process').spawn(process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'], { shell: false, windowsHide: true,
      stdio: ['inherit', 'inherit', 'ignore'] });
  helper.once('spawn', () => fs.writeFileSync(path.join(profile, 'started.json'),
    JSON.stringify({ pid: process.pid, mode, helper: helper.pid })));
} else if (mode === 'never-read') {
  // Keep stdin paused and the process alive, even when its pipe is full.
} else {
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', line => {
    const request = JSON.parse(line);
    if (mode === 'eof') process.exit(0); // Read the request, then close the pipe.
    fs.appendFileSync(path.join(profile, 'executions'), `${request.payload?.label ?? request.method}\n`);
    const reply = () => process.stdout.write(JSON.stringify({ id: request.id, ok: true,
      result: { label: request.payload?.label, pid: process.pid } }) + '\n');
    if (mode === 'late') setTimeout(reply, 1500);
    else if (mode === 'silent') { /* read stdin, never answer */ }
    else reply();
  });
}
