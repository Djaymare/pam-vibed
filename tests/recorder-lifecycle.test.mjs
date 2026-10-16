import test from 'node:test';
import assert from 'node:assert/strict';
import { recorderHarness } from './fixtures/recorder-harness.mjs';
import { deferred, settle } from './fixtures/vue-harness.mjs';
import { createRequire } from 'node:module';
const { validateWav } = createRequire(import.meta.url)('../sidecar/assistant.cjs');
const start = (f, options = {}) => f.recorder.start(() => {}, () => {}, options);

test('PAM-24 recorder: late acquisition result is stopped after repeated disposal', async () => {
  const permission = deferred(), f = recorderHarness({ permission });
  const pending = start(f), a = f.recorder.dispose(), b = f.recorder.dispose();
  assert.equal(a, b); permission.resolve(f.stream);
  assert.equal(await pending, false); assert.equal(f.track.readyState, 'ended'); assert.equal(f.track.stops, 1);
  assert.equal(f.contexts.length, 0); assert.equal(f.media.listeners.size, 0);
});
test('PAM-24 recorder: disposal during module loading stops hardware immediately and closes once', async () => {
  const module = deferred(), close = deferred(), f = recorderHarness({ module, close });
  const pending = start(f); await settle();
  const cleanup = f.recorder.dispose(); assert.equal(f.track.readyState, 'ended'); assert.equal(f.contexts[0].closes, 1);
  assert.equal(f.recorder.dispose(), cleanup); module.resolve(); assert.equal(await pending, false);
  assert.equal(f.worklets.length, 0); close.resolve(); await cleanup;
  assert.equal(f.track.listeners.size, 0); assert.equal(f.contexts[0].listeners.size, 0);
});
test('PAM-24 recorder: disposal while resume waits cannot revive capture or levels', async () => {
  const resume = deferred(), f = recorderHarness({ resume }); let levels = 0;
  const pending = f.recorder.start(() => levels++, () => {}); await settle();
  const port = f.worklets[0].port, oldHandler = port.onmessage;
  await f.recorder.dispose(); resume.resolve(); assert.equal(await pending, false);
  oldHandler({ data: { type: 'samples', chunk: new Float32Array(100) } });
  assert.equal(levels, 0); assert.equal(port.onmessage, null); assert.equal(f.track.readyState, 'ended');
});
test('PAM-24 recorder: explicit device constraint, denied permission and failed worklet recover without leaks', async () => {
  const permission = deferred(), f = recorderHarness({ permission });
  const pending = start(f, { deviceId: 'usb-mic' }); permission.reject(new Error('Permission refused'));
  await assert.rejects(pending, /Permission refused/); assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].audio.deviceId)), { exact: 'usb-mic' });
  assert.equal(f.contexts.length, 0);
  const module = deferred(), g = recorderHarness({ module }); const loading = start(g); await settle(); module.reject(new Error('Worklet failed'));
  await assert.rejects(loading, /Worklet failed/); assert.equal(g.track.readyState, 'ended'); assert.equal(g.contexts[0].closes, 1);
});
test('PAM-24 recorder: finish deduplicates, releases before rendering and preserves valid bounded WAV', async () => {
  const render = deferred(), f = recorderHarness({ render }); await start(f); f.samples(48_000 * 31);
  const a = f.recorder.finish(), b = f.recorder.finish(); assert.equal(a, b); await settle();
  assert.equal(f.track.readyState, 'ended'); assert.equal(f.contexts[0].state, 'closed'); assert.equal(f.worklets[0].stopMessages, 1);
  assert.equal(f.offlines[0].length, 480_000); render.resolve(); const bytes = await a;
  assert.equal(validateWav(Array.from(bytes)).length, 960_044); assert.equal(f.timers.size, 0);
});
test('PAM-24 recorder: cancellation during stop and during resampling cannot produce audio', async () => {
  const f = recorderHarness({ ack: false }); await start(f); f.samples();
  const finishing = f.recorder.finish(); const rejected = assert.rejects(finishing, /annulée/);
  await f.recorder.dispose(); await rejected; assert.equal(f.timers.size, 0); assert.equal(f.offlines.length, 0);
  const render = deferred(), g = recorderHarness({ render }); await start(g); g.samples();
  const p = g.recorder.finish(); const rejectedRender = assert.rejects(p, /annulée/); await settle(); await g.recorder.dispose(); render.resolve(); await rejectedRender;
});
test('PAM-24 recorder: timeout, short clip and suspended context stop hardware and allow a fresh instance', async () => {
  const f = recorderHarness({ ack: false }); await start(f); const p = f.recorder.finish();
  const rejected = assert.rejects(p, /ne répond plus/); [...f.timers.values()][0].fn(); await rejected;
  assert.equal(f.track.readyState, 'ended'); assert.equal(f.timers.size, 0);
  const g = recorderHarness(); await start(g); g.samples(20); await assert.rejects(g.recorder.finish(), /quart de seconde/); assert.equal(g.track.readyState, 'ended');
  const suspended = recorderHarness({ suspended: true }); await assert.rejects(start(suspended), /reste suspendu/); assert.equal(suspended.track.readyState, 'ended');
});
for (const reason of ['ended','mute','devicechange','permission','suspended']) test('PAM-24 recorder: '+reason+' interrupts once, releases listeners and cannot restart', async () => {
  const options = {}, f = recorderHarness(options), errors = [];
  await start(f, { onInterrupted: error => errors.push(error.message) });
  if (reason === 'ended' || reason === 'mute') f.track.fire(reason);
  else if (reason === 'devicechange') { options.devices = []; f.media.fire('devicechange'); }
  else if (reason === 'permission') { f.permission.state = 'denied'; f.permission.fire('change'); }
  else { f.contexts[0].state = 'suspended'; f.contexts[0].fire('statechange'); }
  await settle(); assert.equal(errors.length, 1); assert.match(errors[0], /[Tt]estez|test/); assert.equal(f.track.readyState, 'ended');
  f.track.fire('ended'); f.media.fire('devicechange'); await settle(); assert.equal(errors.length, 1);
  assert.equal(f.track.listeners.size, 0); assert.equal(f.media.listeners.size, 0); assert.equal(f.permission.listeners.size, 0);
  await assert.rejects(start(f), /annulée/);
});
test('PAM-24 recorder: late permission observer is not attached after disposal; meter test retains no PCM', async () => {
  const permissionQuery = deferred(), f = recorderHarness({ permissionQuery }); let level = 0;
  await f.recorder.start(value => level = value, () => {}, { collect: false }); f.samples(); assert.ok(level > 0);
  assert.equal(f.recorder.chunks.length, 0); await f.recorder.dispose(); permissionQuery.resolve(f.permission); await settle();
  assert.equal(f.permission.listeners.size, 0); assert.equal(f.track.readyState, 'ended');
});
