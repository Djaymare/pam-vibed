import test from 'node:test';
import assert from 'node:assert/strict';
import {harness, deferred, settle, status, turn} from './fixtures/vue-harness.mjs';

function application(h) {
  return h.mount((load,vue)=>{
    const profile=load('composables/useProfile.ts').useProfile(h.request,()=>profile?.busy.value??false,()=>{});
    const proposals=load('composables/useProposals.ts').useProposals(profile,()=>profile.busy.value,()=>{});
    const canRequest=()=>profile.runtimeReady.value && !profile.busy.value && audio.state.value==='idle' && profile.activeApps.value.length>0 && !profile.loading.value;
    const requests=load('composables/useRequests.ts').useRequests(profile,proposals,canRequest,()=>profile.busy.value);
    const audio=load('composables/useAudio.ts').useAudio(profile,requests,canRequest);
    const display=load('composables/useAssistantStatus.ts').useAssistantStatus(profile,audio,requests,proposals,canRequest);
    return {profile,requests,audio,proposals,display,canRequest};
  }).value;
}
test('PAM-21 availability follows native supervision and the exact button predicate',async t=>{
  const h=harness(t),f=application(h);await settle();
  assert.equal(f.canRequest(),true);assert.match(f.display.value.label,/PRÊT/);
  for(const phase of ['starting','recovering','stopping','stopped']) {
    f.profile.supervisor.value={phase,activity:'idle'};await settle();
    assert.equal(f.canRequest(),false);assert.doesNotMatch(f.display.value.label,/PRÊT/);
    assert.doesNotMatch(f.profile.runtimeLabel.value,/disponibles|mémoire/);
  }
  f.profile.supervisor.value={phase:'ready',activity:'idle'};
  f.profile.status.value={...status(),ready:false};await settle();assert.equal(f.canRequest(),false);
  f.profile.status.value=status();f.profile.config.value.applications=[];await settle();
  assert.equal(f.canRequest(),false);assert.match(f.display.value.label,/CONFIGURATION/);
});
test('PAM-21 preferences, confirmation, request and native effects have distinct honest stages',async t=>{
  const h=harness(t),f=application(h);await settle();
  let token=f.profile.beginMutation('settings');await settle();
  assert.match(f.display.value.title,/profil/);assert.doesNotMatch(f.display.value.title,/Transcription/);token.finish();
  token=f.profile.beginMutation('confirm');await settle();assert.match(f.display.value.title,/Exécution/);assert.match(f.display.value.detail,/envoyée/);token.finish();
  token=f.profile.beginMutation('process_audio');f.requests.sent.value=true;await settle();assert.match(f.display.value.title,/Transcription et préparation/);
  f.profile.supervisor.value={phase:'ready',activity:'executing'};await settle();assert.match(f.display.value.title,/Exécution/);assert.match(f.display.value.detail,/annulation n’est plus garantie/);token.finish();
  f.proposals.add(turn());await settle();assert.match(f.display.value.label,/CONFIRMATION/);
});
test('PAM-21 cancellation while permission or audio preparation prevents every IPC effect',async t=>{
  const permission=deferred(),finish=deferred();const h=harness(t,{permission:()=>permission.promise,finish:()=>finish.promise});const f=application(h);await settle();
  const first=f.audio.startRecording();await f.audio.cancelRecording();permission.resolve();await first;await settle();
  assert.equal(f.audio.state.value,'idle');assert.equal(h.calls.filter(c=>c.method==='process_audio').length,0);
  await f.audio.startRecording();const processing=f.audio.finishRecording();await settle();assert.match(f.display.value.title,/Préparation de l’enregistrement/);
  await f.audio.cancelRecording();finish.resolve(new Uint8Array([1,2]));await processing;await settle();
  assert.equal(h.calls.filter(c=>c.method==='process_audio').length,0);assert.equal(f.profile.busy.value,false);
});
test('PAM-21 late cancellation cannot hide an already dispatched effect or replay it',async t=>{
  const response=deferred(),h=harness(t,{request:m=>m==='process_audio'?response.promise:undefined});const f=application(h);await settle();
  await f.audio.startRecording();const pending=f.audio.finishRecording();await settle();
  assert.equal(f.requests.sent.value,true);await f.audio.cancelRecording();assert.equal(f.profile.busy.value,true);
  response.resolve({...turn(),status:'executed'});await pending;await settle();
  assert.equal(f.proposals.turns.value[0].status,'executed');assert.equal(h.calls.filter(c=>c.method==='process_audio').length,1);assert.equal(f.audio.state.value,'idle');
});
function walk(n,fn){if(fn(n))return n;for(const c of n.children??[]){const hit=walk(c,fn);if(hit)return hit;}}
function text(n){return n.text+(n.children??[]).map(text).join('');}
test('PAM-21 live result/error regions stay mounted, deduplicate polling and never request focus',async t=>{
  const h=harness(t),rendered=h.mount((load,vue)=>{
    const state=vue.reactive({stage:'Démarrage',turns:[],error:''});const component=load('components/StatusAnnouncements.vue').default;
    return Object.assign(()=>vue.h(component,state),{state});
  });const s=rendered.value.state;await settle();
  const result=()=>walk(rendered.root,n=>'data-result-announcement' in n.props),error=()=>walk(rendered.root,n=>'data-error-announcement' in n.props);
  const region=result();assert.equal(text(region),'');
  s.turns=[turn('one')];await settle();const firstSpan=region.children[0];assert.match(text(region),/Proposition à valider/);
  s.turns=[{...turn('one'),durationMs:983,proposal:{...turn('one').proposal,expiresAt:12}}];await settle();
  assert.equal(result(),region);assert.equal(region.children[0],firstSpan,'No repeated result DOM insertion from health/countdown polling');
  s.turns=[{...turn('one'),status:'executed',results:[{applicationName:'Fixture',message:'Action effectuée',success:true}]}];await settle();assert.match(text(region),/Demande terminée.*Action effectuée/);
  const errorRegion=error();s.error='Échec récupérable';await settle();assert.equal(error(),errorRegion);assert.equal(text(errorRegion),'Échec récupérable');assert.equal(errorRegion.props.role,'alert');
  assert.equal(globalThis.document.activeElement,null);assert.deepEqual(h.errors,[]);
});
test('PAM-21 unavailable supervisor fails closed and late observations are discarded after unmount',async t=>{
  const p=deferred(),h=harness(t,{request:m=>m==='supervisor_status'?p.promise:undefined});const f=application(h);await settle();
  assert.equal(f.canRequest(),false);h.unmount();p.resolve({phase:'ready',activity:'idle'});await settle();
  assert.equal(f.profile.supervisor.value,undefined);assert.equal(h.timers.size,0);
});
test('PAM-21 media preparation and confirmation reject direct submissions during recovery',async t=>{
  const h=harness(t),f=application(h);await settle();f.proposals.add(turn());
  f.profile.supervisor.value={phase:'recovering',activity:'idle'};await settle();
  await f.requests.prepareMediaAction('fixture','media_pause',{},'Pause');
  await f.proposals.resolveTurn(f.proposals.turns.value[0],true);
  assert.equal(h.calls.some(c=>['prepare_action','confirm'].includes(c.method)),false);
});
test('PAM-21 a profile operation cannot erase a failed health observation and restore stale readiness',async t=>{
  let fail=false;const h=harness(t,{request:m=>{if(m==='status'&&fail)throw Error('Health unavailable');}}),f=application(h);await settle();
  fail=true;await f.profile.updateHealth();assert.equal(f.profile.runtimeReady.value,false);
  const token=f.profile.beginMutation('settings');token.finish();await settle();
  assert.equal(f.profile.runtimeReady.value,false);assert.doesNotMatch(f.display.value.label,/PRÊT/);
  fail=false;await f.profile.updateHealth();assert.equal(f.profile.runtimeReady.value,true);
});
