import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, deferred, settle, config, status, turn } from './fixtures/vue-harness.mjs';

// Real Vue setup/render/update/unmount, real PAM IPC validation, mockIPC only
// at invoke. No DOM focus, Rust, WebView2 or physical microphone claims here.
function application(t, handle=()=>undefined) {
  const h=harness(t,{ipc:true,components:true,request:handle});
  const f=h.mount((load,v)=>{
    const page=v.ref('assistant'),request=load('ipc.ts').request;
    let p;const profile=p=load('composables/useProfile.ts').useProfile(request,()=>p?.busy.value??false,()=>{},()=>page.value);
    const proposals=load('composables/useProposals.ts').useProposals(profile,()=>profile.busy.value,()=>{});
    const requests=load('composables/useRequests.ts').useRequests(profile,proposals,()=>profile.runtimeReady.value&&!profile.busy.value,()=>profile.busy.value);
    const editor=load('composables/useApplicationEditor.ts').useApplicationEditor(profile,()=>{});
    return {page,profile,proposals,requests,editor};
  }).value;
  const card=value=>h.mount((load,v)=>()=>v.h(load('components/TurnCard.vue').default,{turn:value,config:config(),locked:f.profile.busy.value,runtimeReady:f.profile.runtimeReady.value}));
  return {h,f,card};
}
const all=n=>[n,...n.children.flatMap(all)],text=n=>n.text+n.children.map(text).join('');
const button=(root,label)=>all(root).find(n=>n.type==='button'&&text(n).trim()===label);
const count=(h,method)=>h.frames.filter(f=>f.method===method).length;
const timeout={code:'request_timeout',stage:'response',message:'Délai de test dépassé.',retryable:false,technical:{category:'request_timeout'}};

test('PAM-32 IPC request success reserves once; structured timeout recovers without replay',async t=>{
  const pending=deferred();let fail=false;
  const {h,f}=application(t,m=>m==='process_text'?(fail?Promise.reject(timeout):pending.promise):undefined);
  await settle();f.requests.text.value='Fixture';
  const first=f.requests.submitText();await f.requests.submitText();
  assert.equal(count(h,'process_text'),2);assert.equal(f.requests.processing.value,true);
  pending.resolve(turn());await first;await settle();
  assert.equal(f.proposals.turns.value.length,1);assert.equal(f.requests.text.value,'');
  fail=true;f.requests.text.value='Retryable draft';await f.requests.submitText();
  assert.match(f.profile.error.value,/request_timeout/);assert.equal(f.profile.busy.value,false);
  assert.equal(f.requests.text.value,'Retryable draft');assert.equal(count(h,'process_text'),2);
  assert.ok(h.frames.every(x=>x.version===1&&x.requestId&&Number.isInteger(x.id)));
});

test('PAM-32 navigation and unmount discard late successes and errors through official IPC mock',async t=>{
  for(const unmount of [false,true]) for(const failure of [false,true]) await t.test(`unmount=${unmount},failure=${failure}`,async t=> {
    const pending=deferred();const {h,f}=application(t,m=>m==='process_text'?pending.promise:undefined);
    await settle();f.requests.text.value='Retained';const call=f.requests.submitText();
    if(unmount)h.unmount();else f.page.value='settings';
    if(failure)pending.reject(timeout);else pending.resolve(turn('obsolete'));await call;await settle();
    assert.equal(f.proposals.turns.value.length,0);assert.equal(f.requests.text.value,'Retained');
    assert.equal(f.profile.error.value,'');
    if(!unmount)h.unmount();assert.equal(h.timers.size,0);assert.deepEqual(h.errors,[]);
  });
});

test('PAM-32 confirmation timeout removes Execute and cannot replay an uncertain effect',async t=>{
  const {h,f,card}=application(t,m=>m==='confirm'?Promise.reject(timeout):undefined);
  await settle();const original=turn();f.proposals.add(original);
  await f.proposals.resolveTurn(original,true);await f.proposals.resolveTurn(original,true);await settle();
  assert.equal(count(h,'confirm'),1);assert.equal(f.proposals.turns.value[0].proposal.state,'unknown');
  const rendered=card(f.proposals.turns.value[0]);await settle();
  assert.equal(button(rendered.root,'Exécuter'),undefined);assert.match(text(rendered.root),/inconnu/);
});

test('PAM-32 expired and config-invalidated proposals never invoke confirmation; runtime disables active card',async t=>{
  const {h,f,card}=application(t);await settle();
  const expired={...turn('expired'),proposal:{...turn().proposal,expiresAt:Date.now()-1}};
  f.proposals.add(expired);await f.proposals.resolveTurn(expired,true);assert.equal(count(h,'confirm'),0);
  const original=turn('config-change');f.proposals.add(original);f.profile.config.value.applications[0].enabled=false;await settle();
  await f.proposals.resolveTurn(original,true);assert.equal(count(h,'confirm'),0);
  const rendered=card(turn('ready'));await settle();assert.ok(button(rendered.root,'Exécuter'));
  f.profile.supervisor.value={phase:'recovering',activity:'idle'};await settle();
  assert.equal(button(rendered.root,'Exécuter').props.disabled,true);
  assert.deepEqual(h.errors,[]);
});

test('PAM-32 correction success invalidates original; duplicate submit and obsolete correction stay bounded',async t=>{
  const pending=deferred();const {h,f}=application(t,m=>m==='correct_request'?pending.promise:undefined);
  await settle();const original=turn();f.proposals.add(original);f.proposals.editTurn(original);
  f.proposals.correctionForm.text='Corrected';const first=f.proposals.correctTurn();await f.proposals.correctTurn();
  assert.equal(count(h,'correct_request'),1);pending.resolve(turn('corrected'));await first;await settle();
  assert.equal(f.proposals.correction.value,undefined);
  assert.deepEqual(f.proposals.turns.value.map(x=>[x.id,x.status]),[['corrected','pending'],['turn','invalidated']]);
});

test('PAM-32 editing failure retains draft; success and deletion use validated IPC and explicit confirmation',async t=>{
  let fail=true;const saved=config('Saved');
  const {h,f}=application(t,(m,p)=>{
    if(m==='save_application'){if(fail)throw timeout;return saved;}
    if(m==='delete_application')return {...saved,applications:[]};
  });
  await settle();f.editor.editApplication(f.profile.config.value.applications[0]);await settle();
  f.editor.form.name='Draft';await f.editor.saveApplication();
  assert.equal(f.editor.editorOpen.value,true);assert.equal(f.editor.form.name,'Draft');assert.match(f.editor.formError.value,/request_timeout/);
  fail=false;await f.editor.saveApplication();assert.equal(f.editor.editorOpen.value,false);
  assert.equal(f.profile.config.value.applications[0].name,'Saved');
  f.profile.deleteApplication(f.profile.config.value.applications[0]);f.profile.cancelDeletion();await f.profile.confirmDeletion();
  assert.equal(count(h,'delete_application'),0);
  f.profile.deleteApplication(f.profile.config.value.applications[0]);await f.profile.confirmDeletion();
  assert.equal(count(h,'delete_application'),1);assert.equal(f.profile.config.value.applications.length,0);
});

test('PAM-32 shared renderer unmounts every root and releases all owned timers',async t=>{
  const {h,card}=application(t);await settle();card(turn());await settle();
  assert.ok(h.timers.size>0);h.unmount();h.unmount();await settle();
  assert.equal(h.timers.size,0);assert.equal(h.events.size,0);assert.deepEqual(h.errors,[]);
});
