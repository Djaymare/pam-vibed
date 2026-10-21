import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createSidecarClient } from './fixtures/sidecar-client.cjs';

function fixture(t, behavior, options) {
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    const readline = require('node:readline');
    readline.createInterface({input:process.stdin}).on('line', line => {
      const request = JSON.parse(line);
      const reply = {version:1,requestId:request.requestId,id:request.id,ok:true,result:'complete'};
      ${behavior}
    });
  `], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill(); await closed; });
  return { child, client: createSidecarClient(child, options) };
}

test('protocol fixture drains noisy stderr and waits for the final reply after progress', async t => {
  const { client } = fixture(t, `
    fs.writeSync(2, Buffer.alloc(2 * 1024 * 1024, 'x'));
    process.stdout.write(JSON.stringify({...reply,type:'diagnostic'})+'\\n');
    process.stdout.write(JSON.stringify({...reply,type:'turn_progress',result:'progress'})+'\\n');
    const text=JSON.stringify(reply)+'\\n';
    process.stdout.write(text.slice(0,10));
    setImmediate(()=>process.stdout.write(text.slice(10)));
  `);
  assert.equal((await client.request('status')).result, 'complete');
  assert.ok(Buffer.byteLength(client.describe()) < 8400);
});

test('protocol fixture reports native child death while a request is pending', async t => {
  const { client } = fixture(t, "process.stderr.write('native failure',()=>process.exit(70));");
  await assert.rejects(client.request('process_text'), /closed code=70.*process_text:sent.*native failure/);
});

test('protocol fixture times out an unanswered request with its method', async t => {
  const { client } = fixture(t, '', { timeoutMs: 50 });
  await assert.rejects(client.request('restart_engine'), /request timed out: restart_engine/);
});

test('protocol fixture rejects malformed responses and failed process startup', async t => {
  const { client } = fixture(t, "process.stdout.write('not-json\\n');");
  await assert.rejects(client.request('status'), /Invalid JSON/);
  const child = spawn('pam33-deliberately-absent-executable', [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  const missing = createSidecarClient(child);
  await assert.rejects(missing.request('status'), /spawn error|stdin error|write failed/);
  await closed;
});
