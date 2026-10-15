const test = require('node:test');
const assert = require('node:assert/strict');
const { createHostChannel, hostLauncher, hostNativeRequest } = require('./host.cjs');
const requestId='11111111-1111-4111-8111-111111111111';
const failure=require('./diagnostics.cjs').envelope('target_missing',requestId,'host');

test('host launches correlate replies and preserve literal arguments', async () => {
  const sent = [];
  const host = createHostChannel(line => sent.push(JSON.parse(line)));
  host.setContext(requestId);
  const launch = hostLauncher(host.request);
  const app = { name: 'Fixture', executable: 'C:\\fixture.exe', arguments: ['{input}', '&literal'] };
  const first = launch(app, { input: 'a" & | % b' });
  const second = launch(app, { input: 'second' });
  assert.deepEqual(sent[0].payload.arguments, ['a" & | % b', '&literal']);
  assert.notEqual(sent[0].id, sent[1].id);
  host.receive({ version:1,requestId,type: 'host_response', id: sent[1].id, ok: false, error: failure });
  await assert.rejects(second, e=>e.diagnostic.code==='target_missing');
  host.receive({ version:1,requestId,type: 'host_response', id: sent[0].id, ok: true, result: { accepted: true, pid: 42 } });
  assert.equal((await first).details.pid, 42);
  assert.equal(host.receive({ id: 1 }), false);
  assert.equal(host.receive({ version:1,type: 'host_response', id: sent[0].id, ok: true }), true);
});

test('lost replies expire without a launch retry; EOF rejects pending requests', async () => {
  let writes = 0;
  const host = createHostChannel(() => writes++, { timeout: 10 });
  host.setContext(requestId);
  await assert.rejects(host.request('launch_application', {executable:'C:\\fixture.exe',arguments:[]}), /ne sera pas rejouée/);
  assert.equal(writes, 1);
  const pending = host.request('deezer_open', {method:'deezer_open',uri:'deezer://www.deezer.com/album/1'});
  host.close();
  await assert.rejects(pending, /interrompu/);
  assert.equal(writes, 2);
});

test('protocol launches use the host; internal media helpers stay in the sidecar', async () => {
  const calls = [];
  const native = hostNativeRequest((method, payload) => { calls.push({ host: method, payload }); return { accepted: true }; },
    payload => { calls.push({ helper: payload.method }); return []; });
  const protocol = { method: 'deezer_open', uri: 'deezer://www.deezer.com/album/1' };
  assert.equal((await native(protocol)).accepted, true);
  await native({ method: 'media_sessions' });
  await native({ method: 'media_action', action: 'pause' });
  assert.deepEqual(calls, [{ host: 'deezer_open', payload: protocol }, { helper: 'media_sessions' }, { helper: 'media_action' }]);
});
