// Wait for the first request, after Rust has assigned Node to its job.
// The real sidecar and real engine handle all requests.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
process.stdin.once('data', () => {
  const profile = process.argv[3];
  const helper = spawn(process.env.PAM_PROCESS_FIXTURE, [path.join(profile, 'auxiliary.txt')],
    { shell: false, windowsHide: true, stdio: 'ignore' });
  helper.once('spawn', () => fs.writeFileSync(path.join(profile, 'internal.json'), JSON.stringify({ node: process.pid, auxiliary: helper.pid })));
});
require('../../sidecar/main.cjs');
