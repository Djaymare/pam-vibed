import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, deferred, settle } from './fixtures/vue-harness.mjs';
import { Target } from './fixtures/recorder-harness.mjs';
function fixture(t, options = {}) {
  const media = new Target();
  let entries = [{ kind: 'audioinput', deviceId: 'usb', label: 'USB' }, { kind: 'audioinput', deviceId: 'headset', label: 'Casque' }];
  media.enumerateDevices = async () => options.enumerate ? options.enumerate() : entries;
  const previous = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
  t.after(() => { if (previous) Object.defineProperty(navigator, 'mediaDevices', previous); else delete navigator.mediaDevices; });
  const starts = [], processes = [], h = harness(t, { ...options, audioStart: value => { starts.push(value); options.audioStart?.(value); } });
  const mounted = h.mount((feature, vue) => {
    const scope = feature('composables/useAsyncScope.ts').useAsyncScope(), mutation = scope.operation(), error = vue.ref('');
    const profile = { scope, mutation, error, beginMutation: kind => mutation.begin(kind), request: h.request };
    const requests = { sent: vue.ref(false), process: async (...args) => processes.push(args) };
    const audio = feature('composables/useAudio.ts').useAudio(profile, requests, () => options.allowVoice ?? true, () => true);
    return { audio, profile, requests };
  });
  return { h, media, starts, processes, ...mounted.value, setEntries: value => { entries = value; } };
}
test('PAM-24 microphone test: works before a configured app, no transcription, bounded five seconds and duplicate start ignored', async t => {
  const f = fixture(t, { allowVoice: false }); await settle();
  await Promise.all([f.audio.testMicrophone(), f.audio.testMicrophone()]);
  assert.equal(f.starts.length, 1); assert.equal(f.starts[0].options.collect, false); assert.equal(f.audio.state.value, 'testing');
  f.starts[0].level(.3); [...f.h.timers.values()].find(timer => timer.ms === 5000).fn(); await settle();
  assert.equal(f.audio.state.value, 'idle'); assert.match(f.audio.testResult.value, /Signal détecté/);
  assert.equal(f.h.resources.finishes, 0); assert.equal(f.processes.length, 0); assert.equal(f.h.timers.size, 0);
});
test('PAM-24 microphone test: silence and manual cancel leave a recoverable idle state', async t => {
  const f = fixture(t); await settle(); await f.audio.testMicrophone();
  [...f.h.timers.values()].find(timer => timer.ms === 5000).fn(); await settle(); assert.match(f.audio.testResult.value, /Aucun son détecté/);
  await f.audio.testMicrophone(); const a = f.audio.cancelRecording(), b = f.audio.cancelRecording();
  assert.equal(a,b); await a; assert.equal(f.audio.testing.value, false); assert.equal(f.h.timers.size, 0); assert.equal(f.processes.length, 0);
});
test('PAM-24 microphone discovery: newest response wins, unmount removes all device/lifecycle listeners', async t => {
  const a=deferred(), b=deferred(); let calls=0;
  const f=fixture(t,{enumerate:()=>++calls===1?a.promise:b.promise});
  const refresh=f.audio.refreshDevices(); b.resolve([{kind:'audioinput',deviceId:'fresh',label:'Nouveau'}]); await refresh;
  a.resolve([{kind:'audioinput',deviceId:'old',label:'Ancien'}]); await settle();
  assert.equal(f.audio.devices.value[0].deviceId,'fresh'); f.h.unmount(); await settle();
  assert.equal(f.media.listeners.size,0); assert.equal(f.h.domEvents.size,0); assert.equal(f.h.timers.size,0);
});
test('PAM-24 microphone selection: no silent fallback when chosen input disappears; replug works without profile reload', async t => {
  const f=fixture(t); await settle(); f.audio.selectDevice('usb'); await f.audio.testMicrophone();
  f.audio.selectDevice('headset'); assert.equal(f.audio.selectedDeviceId.value,'usb');
  assert.equal(f.starts[0].options.deviceId,'usb'); await f.audio.cancelRecording();
  f.setEntries([{kind:'audioinput',deviceId:'headset',label:'Casque'}]); f.media.fire('devicechange'); await settle();
  assert.match(f.audio.deviceError.value,/plus disponible/); await f.audio.startRecording(); assert.equal(f.starts.length,1);
  f.setEntries([{kind:'audioinput',deviceId:'usb',label:'USB'}]); await f.audio.refreshDevices();
  assert.equal(f.audio.deviceError.value,''); await f.audio.testMicrophone(); assert.equal(f.starts.length,2);
  assert.equal(f.h.calls.filter(call=>call.method==='status').length,0);
});
test('PAM-24 microphone permission: cancel/navigation/late grant never installs capture timers or a stale error', async t => {
  const permission=deferred(), f=fixture(t,{permission:()=>permission.promise}); await settle();
  const pending=f.audio.startRecording(); assert.equal(f.audio.state.value,'permission');
  f.profile.scope.invalidate(); await settle(); permission.resolve(); await pending; await settle();
  assert.equal(f.audio.state.value,'idle'); assert.equal(f.h.timers.size,0); assert.equal(f.profile.error.value,'');
  assert.ok(f.h.resources.disposed>=1); assert.equal(f.processes.length,0);
});
for (const event of ['pagehide','visibilitychange','freeze']) test('PAM-24 microphone lifecycle: '+event+' stops capture, visible/resume never restarts', async t => {
  const f=fixture(t); await settle(); await f.audio.startRecording();
  if(event==='visibilitychange'){ f.h.document.visibilityState='hidden'; f.h.dispatch(event,'document'); }
  else f.h.dispatch(event,event==='pagehide'?'window':'document');
  await settle(); assert.equal(f.audio.state.value,'idle'); assert.equal(f.h.timers.size,0); assert.match(f.audio.microphoneError.value,/interrompue/);
  f.h.document.visibilityState='visible'; f.h.dispatch('visibilitychange','document'); f.h.dispatch('resume','document'); await settle();
  assert.equal(f.starts.length,1); assert.equal(f.processes.length,0); await f.audio.testMicrophone(); assert.equal(f.starts.length,2);
});
test('PAM-24 microphone sleep: elapsed wall-clock gap cancels rather than processing delayed audio', async t => {
  let now=1000; t.mock.method(Date,'now',()=>now);
  const f=fixture(t); await settle(); await f.audio.startRecording(); now+=10_000;
  [...f.h.timers.values()].find(timer=>timer.ms===1000).fn(); await settle();
  assert.equal(f.audio.state.value,'idle'); assert.match(f.audio.microphoneError.value,/veille/); assert.equal(f.processes.length,0);
  await f.audio.startRecording(); assert.equal(f.starts.length,2); await f.audio.finishRecording(); assert.equal(f.processes.length,1);
});
test('PAM-24 microphone interrupt: error is actionable and stale interruption cannot affect a fresh capture', async t => {
  const f=fixture(t); await settle(); await f.audio.startRecording(); const old=f.starts[0].options.onInterrupted;
  old(new Error('Débranché : rebranchez puis testez.')); await settle();
  assert.match(f.audio.microphoneError.value,/rebranchez/); assert.equal(f.audio.state.value,'idle');
  await f.audio.testMicrophone(); old(new Error('obsolete')); await settle(); assert.equal(f.audio.microphoneError.value,''); assert.equal(f.audio.state.value,'testing');
});
test('PAM-24 microphone panel: multiple inputs, explicit selection and unavailable choice remain accessible', async t => {
  const h = harness(t, { components: true }); let audio;
  const mounted = h.mount((feature, vue) => {
    audio = vue.reactive({ state: 'idle', devices: [{deviceId:'a',label:'USB'}, {deviceId:'b',label:'Casque'}], selectedDeviceId:'', microphoneError:'',deviceError:'',testResult:'',refreshingDevices:false,testing:false,requestingMic:false,level:0,testMicrophone(){},refreshDevices(){},cancelRecording(){},selectDevice(value){audio.selectedDeviceId=value;} });
    return () => vue.h(feature('components/MicrophonePanel.vue').default, { audio, disabled:false });
  });
  const all = node => [node,...node.children.flatMap(all)];
  let select = all(mounted.root).find(node=>node.type==='select');
  assert.equal(select.props['aria-describedby'],'microphone-help microphone-message');
  assert.equal(select.children.filter(node=>node.type==='option').length,3);
  select.props.onChange({target:{value:'b'}}); await settle(); assert.equal(audio.selectedDeviceId,'b');
  audio.devices=[{deviceId:'a',label:'USB'}]; audio.deviceError='Rebranchez le microphone'; await settle();
  assert.ok(all(mounted.root).some(node=>node.type==='option'&&node.props.disabled!==undefined&&node.props.disabled!==false));
  assert.equal(all(mounted.root).find(node=>node.props.id==='microphone-message').props.role,'alert');
  audio.state='permission'; await settle(); select=all(mounted.root).find(node=>node.type==='select'); assert.equal(select.props.disabled,true);
  assert.deepEqual(h.errors,[]);
});
