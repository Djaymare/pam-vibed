import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, deferred, settle, config, status, turn } from './fixtures/vue-harness.mjs';

function application(h, extra=()=>({})) {
  return h.mount((load,vue)=>{
    const page=vue.ref('assistant'); let p;
    const profile=load('composables/useProfile.ts').useProfile(h.request,()=>p?.busy.value??false,()=>{},()=>page.value);p=profile;
    const proposals=load('composables/useProposals.ts').useProposals(profile,()=>profile.busy.value,()=>{});
    const requests=load('composables/useRequests.ts').useRequests(profile,proposals,()=>!profile.busy.value,()=>profile.busy.value);
    return {page,profile,proposals,requests,...extra(load,vue,profile,requests)};
  }).value;
}
test('PAM-17 status: health coalesces; newer refresh wins in either completion order',async t=>{
  const pending=[];
  const h=harness(t,{request(method){if(method==='status'){const p=deferred();pending.push(p);return p.promise;}}});
  const f=application(h);
  pending[0].resolve(status());await settle();
  const old=f.profile.updateHealth();const coalesced=f.profile.updateHealth();
  assert.equal(pending.length,2);await coalesced;
  const fresh=f.profile.refresh();assert.equal(pending.length,3);
  pending[2].resolve(status('New'));await fresh;
  pending[1].resolve(status('Old'));await old;
  assert.equal(f.profile.status.value.config.applications[0].name,'New');
  assert.equal(f.profile.config.value.applications[0].name,'New');
});
test('PAM-17 status: navigation/unmount during initial call ignores data and does not install a timer',async t=>{
  const p=deferred(),h=harness(t,{request:m=>m==='status'?p.promise:undefined});
  const f=application(h);h.unmount();p.resolve(status('Stale'));await settle();
  assert.equal(f.profile.status.value,undefined);assert.equal(h.timers.size,0);assert.deepEqual(h.errors,[]);
});
test('PAM-17 requests: double submit/direct event produces one effect; navigation ignores result and keeps reservation',async t=>{
  const p=deferred(),h=harness(t,{request:m=>m==='process_text'?p.promise:undefined});
  const f=application(h);await settle();f.requests.text.value='Fixture';
  const first=f.requests.submitText(),second=f.requests.submitText();
  assert.equal(h.calls.filter(x=>x.method==='process_text').length,1);
  f.page.value='settings';
  await f.requests.process('process_text',{text:'Duplicate'});
  assert.equal(f.profile.busy.value,true);
  p.resolve(turn());await Promise.all([first,second]);
  assert.equal(f.proposals.turns.value.length,0);assert.equal(f.requests.text.value,'Fixture');
  assert.equal(f.profile.busy.value,false);
});
test('PAM-17 profile: double write ignored and stale configuration cannot overwrite after navigation',async t=>{
  const p=deferred(),h=harness(t,{request:m=>m==='settings'?p.promise:undefined});
  const f=application(h);await settle();
  const first=f.profile.saveSettings();await f.profile.saveSettings();
  assert.equal(h.calls.filter(x=>x.method==='settings').length,1);
  f.page.value='assistant-other';p.resolve(config('Stale'));await first;
  assert.equal(f.profile.config.value.applications[0].name,'Initial');assert.equal(f.profile.busy.value,false);
});
test('PAM-17 profile: old failing call after unmount cannot display an error',async t=>{
  const p=deferred(),h=harness(t,{request:m=>m==='restart_engine'?p.promise:undefined});
  const f=application(h);await settle();const call=f.profile.restartEngine();
  h.unmount();p.reject(Error('Stale failure'));await call;
  assert.equal(f.profile.error.value,'');assert.equal(h.timers.size,0);
});
test('PAM-17 local loading: diagnostics never enters request/voice processing and rejects double click',async t=>{
  const p=deferred(),h=harness(t,{request:m=>m==='export_diagnostics'?p.promise:undefined});
  const f=application(h);await settle();const first=f.profile.exportDiagnostics();await f.profile.exportDiagnostics();
  assert.equal(h.calls.filter(x=>x.method==='export_diagnostics').length,1);
  assert.equal(f.profile.diagnostics.pending.value,true);
  assert.equal(f.requests.processing.value,false);assert.equal(f.requests.voiceProcessing.value,false);
  p.resolve({format:1});await first;assert.equal(f.profile.diagnostics.pending.value,false);
});
test('PAM-17 audio: duplicate start + late permission after cancel leaves no recorder/timer; retry works',async t=>{
  const p=deferred(),h=harness(t,{permission:()=>p.promise});
  const f=application(h,(load,_v,profile,requests)=>({audio:load('composables/useAudio.ts').useAudio(profile,requests,()=>true)}));
  await settle();const first=f.audio.startRecording();await f.audio.startRecording();
  assert.equal(h.resources.starts,1);await f.audio.cancelRecording();p.resolve();await first;
  assert.equal(f.audio.state.value,'idle');assert.ok(h.resources.disposed>=1);
  assert.equal([...h.timers.values()].some(x=>x.ms===29500),false);
  await f.audio.startRecording();assert.equal(f.audio.recording.value,true);
  await f.audio.cancelRecording();assert.equal(f.audio.recording.value,false);
});
test('PAM-17 audio: permission rejects after unmount without error/journal or recreated timers',async t=>{
  const p=deferred(),h=harness(t,{permission:()=>p.promise});
  const f=application(h,(load,_v,profile,requests)=>({audio:load('composables/useAudio.ts').useAudio(profile,requests,()=>true)}));
  await settle();const first=f.audio.startRecording();h.unmount();
  p.reject(new DOMException('Denied','NotAllowedError'));await first;await settle();
  assert.equal(f.profile.error.value,'');assert.equal(h.timers.size,0);
  assert.equal(h.calls.some(x=>x.method==='diagnostic_event'),false);
});
test('PAM-17 audio: duplicate finish captures once; cancellation during capture prevents IPC',async t=>{
  const p=deferred(),h=harness(t,{finish:()=>p.promise});
  const f=application(h,(load,_v,profile,requests)=>({audio:load('composables/useAudio.ts').useAudio(profile,requests,()=>true)}));
  await settle();await f.audio.startRecording();const first=f.audio.finishRecording();await f.audio.finishRecording();
  assert.equal(h.resources.finishes,1);await f.audio.cancelRecording();p.resolve(new Uint8Array([1,2]));await first;
  assert.equal(h.calls.some(x=>x.method==='process_audio'),false);assert.equal(f.profile.busy.value,false);
});
test('PAM-17 proposals: duplicate confirm/discard has one authorized call',async t=>{
  const p=deferred(),h=harness(t,{request:m=>m==='confirm'?p.promise:undefined});
  const f=application(h);await settle();const original=turn();f.proposals.add(original);
  const first=f.proposals.resolveTurn(original,true);await f.proposals.resolveTurn(original,false);
  assert.equal(h.calls.filter(x=>['confirm','discard'].includes(x.method)).length,1);
  p.resolve({...original,status:'executed'});await first;
  assert.equal(f.proposals.turns.value[0].status,'executed');
});
test('PAM-17 correction: old dialog response after navigation cannot replace profile or add history',async t=>{
  const p=deferred(),h=harness(t,{request:m=>m==='correct_request'?p.promise:undefined});
  const f=application(h);await settle();f.proposals.editTurn(turn());
  const first=f.proposals.correctTurn();await f.proposals.correctTurn();f.page.value='settings';
  p.resolve(turn('corrected'));await first;
  assert.equal(h.calls.filter(x=>x.method==='correct_request').length,1);
  assert.equal(f.proposals.correction.value,undefined);assert.equal(f.proposals.turns.value.length,0);
});
test('PAM-17 editor: late discovery is discarded after close, then fresh discovery wins',async t=>{
  const pending=[],h=harness(t,{request(m){if(m==='discover_applications'){const p=deferred();pending.push(p);return p.promise;}}});
  const f=application(h,(load,_v,profile)=>({editor:load('composables/useApplicationEditor.ts').useApplicationEditor(profile,()=>{})}));
  await settle();const first=f.editor.addApplication();await f.editor.discoverApplications();assert.equal(pending.length,1);
  f.editor.closePicker();const fresh=f.editor.addApplication();assert.equal(pending.length,2);
  pending[1].resolve([{appId:'new'}]);await fresh;pending[0].resolve([{appId:'old'}]);await first;
  assert.equal(f.editor.installedApplications.value[0].appId,'new');
});
test('PAM-17 editor: native chooser resolving after navigation cannot rewrite new form',async t=>{
  const p=deferred(),h=harness(t,{open:()=>p.promise});
  const f=application(h,(load,_v,profile)=>({editor:load('composables/useApplicationEditor.ts').useApplicationEditor(profile,()=>{})}));
  await settle();f.editor.editApplication();await settle();const call=f.editor.browse();
  f.page.value='settings';f.editor.editApplication();f.editor.form.executable='new.exe';p.resolve('old.exe');await call;
  assert.equal(f.editor.form.executable,'new.exe');
});
test('PAM-17 editor: test double click emits once; edited input invalidates result',async t=>{
  const p=deferred(),h=harness(t,{request:m=>m==='test_application'?p.promise:undefined});
  const f=application(h,(load,_v,profile)=>({editor:load('composables/useApplicationEditor.ts').useApplicationEditor(profile,()=>{})}));
  await settle();f.editor.editApplication();await settle();const first=f.editor.testLaunch();await f.editor.testLaunch();
  assert.equal(h.calls.filter(x=>x.method==='test_application').length,1);
  f.editor.testInput.value='Changed';await settle();p.resolve({success:true,message:'Old'});await first;
  assert.equal(f.editor.testResult.value,undefined);assert.equal(f.editor.testing.value,false);
});
test('PAM-17 editor: duplicate save and navigation cannot write profile or close new dialog',async t=>{
  const p=deferred(),h=harness(t,{request:m=>m==='save_application'?p.promise:undefined});
  const f=application(h,(load,_v,profile)=>({editor:load('composables/useApplicationEditor.ts').useApplicationEditor(profile,()=>{})}));
  await settle();f.editor.editApplication();await settle();const first=f.editor.saveApplication();await f.editor.saveApplication();
  assert.equal(h.calls.filter(x=>x.method==='save_application').length,1);
  f.page.value='settings';p.resolve(config('Old'));await first;
  assert.equal(f.profile.config.value.applications[0].name,'Initial');assert.equal(f.editor.editorOpen.value,false);
});
test('PAM-17 listeners: failed second registration releases first, reports error and retries',async t=>{
  let fail=true,toggles=0;const h=harness(t,{listen:async event=>{if(fail && event==='pam-cancel-voice')throw Error('Registration failed');}});
  const f=h.mount(load=>load('composables/useVoiceShortcuts.ts').useVoiceShortcuts(()=>toggles++,()=>{})).value;
  await settle();assert.equal(h.events.size,0);assert.match(f.error.value,/raccourcis/);assert.deepEqual(h.errors,[]);
  fail=false;await f.install();assert.equal(h.events.size,2);assert.equal(f.error.value,'');
  h.events.get('pam-toggle-voice')();h.events.get('pam-toggle-voice')();assert.equal(toggles,1);
  h.unmount();assert.equal(h.events.size,0);
});
test('PAM-17 listeners: installation resolving after unmount releases late listener without registering another',async t=>{
  const p=deferred();let registrations=0;const h=harness(t,{listen:async()=>{registrations++;await p.promise;}});
  h.mount(load=>load('composables/useVoiceShortcuts.ts').useVoiceShortcuts(()=>assert.fail('stale event'),()=>{}));
  h.unmount();p.resolve();await settle();
  assert.equal(registrations,1);assert.equal(h.events.size,0);assert.deepEqual(h.errors,[]);
});

test('PAM-17 audio: navigation while idle permits a shortcut start in the same event',async t=>{
  const h=harness(t);
  const f=application(h,(load,_v,profile,requests)=>({audio:load('composables/useAudio.ts').useAudio(profile,requests,()=>true)}));
  await settle();f.page.value='settings';const start=f.audio.startRecording();await start;
  assert.equal(f.audio.recording.value,true);assert.equal(h.resources.starts,1);
});
test('PAM-17 status: obsolete error cannot erase newer successful refresh',async t=>{
  const pending=[],h=harness(t,{request:m=>{if(m==='status'){const p=deferred();pending.push(p);return p.promise;}}});
  const f=application(h);const fresh=f.profile.refresh();
  pending[0].reject(Error('Obsolete error'));await settle();
  assert.equal(f.profile.error.value,'');assert.equal(f.profile.loading.value,true);
  pending[1].resolve(status('Fresh'));await fresh;
  assert.equal(f.profile.status.value.config.applications[0].name,'Fresh');
});
test('PAM-17 media: direct double refresh coalesces and listener-free failure is recoverable',async t=>{
  const pending=[],h=harness(t,{components:true,request:m=>{if(m==='media_sessions'){const p=deferred();pending.push(p);return p.promise;}}});
  const app={...config().applications[0],media:{sourceAppId:'fixture'}};
  const f=h.mount((load,v)=>()=>v.h(load('components/MediaControls.vue').default,{applications:[app],locked:false}));
  const all=n=>[n,...n.children.flatMap(all)],text=n=>n.text+n.children.map(text).join('');
  const button=()=>all(f.root).find(n=>n.type==='button'&&text(n).includes('sessions'));
  button().props.onClick();button().props.onClick();assert.equal(pending.length,1);
  pending[0].reject(Error('Session indisponible'));await settle();
  assert.match(text(f.root),/Session indisponible/);
  button().props.onClick();assert.equal(pending.length,2);
  h.unmount();pending[1].resolve([{sourceAppId:'fixture',title:'Late'}]);await settle();
  assert.deepEqual(h.errors,[]);
});
test('PAM-17 transfer: duplicate preview and changed content discard the obsolete preview',async t=>{
  const p=deferred(),h=harness(t,{components:true,request:m=>m==='preview_import'?p.promise:undefined});
  const f=h.mount((load,v)=>()=>v.h(load('components/ProfileTransfer.vue').default,{request:h.request,locked:false}));
  const all=n=>[n,...n.children.flatMap(all)],text=n=>n.text+n.children.map(text).join('');
  const input=all(f.root).find(n=>n.type==='textarea'&&n.props['aria-label']==='Profil à importer');
  input.props['onUpdate:modelValue']('old');await settle();
  const button=all(f.root).find(n=>n.type==='button'&&text(n).trim()==='Vérifier l’import');
  const first=button.props.onClick();button.props.onClick();
  assert.equal(h.calls.filter(x=>x.method==='preview_import').length,1);
  input.props['onUpdate:modelValue']('new');
  p.resolve({summary:{applications:['Old preview'],formulations:0,language:'fr',autoExecute:true,confidenceThreshold:0.7}});
  await first;await settle();assert.equal(text(f.root).includes('Old preview'),false);assert.deepEqual(h.errors,[]);
});

test('PAM-17 status: health restores the initial profile after a failed first read',async t=>{
  let count=0;const h=harness(t,{request:m=>m==='status'?(++count===1?Promise.reject(Error('Offline')):Promise.resolve(status('Recovered'))):undefined});
  const f=application(h);await settle();assert.equal(f.profile.health.state.value,'error');
  await f.profile.updateHealth();assert.equal(f.profile.config.value.applications[0].name,'Recovered');
  assert.equal(f.profile.health.state.value,'success');
});
