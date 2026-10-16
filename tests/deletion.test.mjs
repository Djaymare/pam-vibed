import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, deferred, settle, config, status } from './fixtures/vue-harness.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {createAssistant,DEFAULT_CONFIG}=require('../sidecar/assistant.cjs');
const {deletionFingerprint:nodeFingerprint}=require('../sidecar/assistant/deletion-scope.cjs');
const learned=()=>{const c=config();c.applications[0].aliases=['Mon éditeur'];c.commandAliases=[{id:'phrase',applicationId:'fixture',phrase:'Ouvre mon texte',action:'open'}];return c;};
function mount(h){return h.mount((load,v)=>{let p;const page=v.ref('applications');p=load('composables/useProfile.ts').useProfile(h.request,()=>p?.busy.value??false,()=>{},()=>page.value);return {p,page,deletion:load('deletion.ts')};}).value;}

test('PAM-20 accidental app/formulation clicks and late cancellation send no delete; scope is an immutable snapshot',async t=>{
  const c=learned(),h=harness(t,{request:m=>m==='status'?Promise.resolve({...status(),config:c}):undefined}),{p}=mount(h);await settle();
  p.deleteApplication(p.config.value.applications[0]);assert.equal(h.calls.some(c=>c.method.startsWith('delete_')),false);
  assert.deepEqual(p.deletion.value.aliases.map(a=>a.phrase),['Ouvre mon texte']);assert.deepEqual(p.deletion.value.application.aliases,['Mon éditeur']);
  c.commandAliases[0].phrase='Modification ultérieure';assert.equal(p.deletion.value.aliases[0].phrase,'Ouvre mon texte');
  p.cancelDeletion();await p.confirmDeletion();assert.equal(p.deletion.value,undefined);
  await p.deleteCommandAlias('phrase');assert.equal(p.deletion.value.kind,'formulation');p.cancelDeletion();await p.confirmDeletion();
  assert.equal(h.calls.some(c=>c.method.startsWith('delete_')),false);
});
test('PAM-20 double confirm emits once, cancellation during persistence is refused and success consumes the confirmation',async t=>{
  const pending=deferred(),sent=deferred(),h=harness(t,{request:m=>m==='status'?Promise.resolve({...status(),config:learned()}):m==='delete_application'?(sent.resolve(),pending.promise):undefined}),{p}=mount(h);await settle();
  p.deleteApplication(p.config.value.applications[0]);const first=p.confirmDeletion(),second=p.confirmDeletion();await sent.promise;
  assert.equal(p.deleting.value,true);p.cancelDeletion();assert.ok(p.deletion.value);
  assert.equal(h.calls.filter(c=>c.method==='delete_application').length,1);
  assert.match(h.calls.find(c=>c.method==='delete_application').payload.expectedFingerprint,/^[a-f0-9]{64}$/);
  pending.resolve({...config(),applications:[],commandAliases:[]});await Promise.all([first,second]);await p.confirmDeletion();p.cancelDeletion();
  assert.equal(h.calls.filter(c=>c.method==='delete_application').length,1);assert.equal(p.deletion.value,undefined);assert.equal(p.config.value.applications.length,0);assert.match(p.deletionNotice.value,/supprimées/);
});
test('PAM-20 failure retains exact scope and profile; no blind retry before a new confirmation',async t=>{
  const h=harness(t,{request:m=>m==='status'?Promise.resolve({...status(),config:learned()}):m==='delete_command_alias'?Promise.reject(Error('Écriture refusée')):undefined}),{p}=mount(h);await settle();
  await p.deleteCommandAlias('phrase');const before=JSON.stringify(p.config.value);await p.confirmDeletion();
  assert.match(p.deletionError.value,/Écriture refusée.*pas confirmée/);assert.equal(JSON.stringify(p.config.value),before);assert.ok(p.deletion.value);
  await p.confirmDeletion();assert.equal(h.calls.filter(c=>c.method==='delete_command_alias').length,1);p.cancelDeletion();assert.equal(p.deletionError.value,'');
});
test('PAM-20 navigation/unmount discards late delete delivery without replay; navigation warns that the sent effect cannot be cancelled',async t=>{
  for(const unmount of [false,true]){
    const pending=deferred(),sent=deferred(),h=harness(t,{request:m=>m==='delete_application'?(sent.resolve(),pending.promise):undefined}),{p,page}=mount(h);await settle();p.deleteApplication(p.config.value.applications[0]);const job=p.confirmDeletion();await sent.promise;
    if(unmount)h.unmount();else page.value='settings';assert.equal(p.deletion.value,undefined);assert.match(p.deletionNotice.value,/déjà été envoyée/);
    pending.resolve({...config(),applications:[],commandAliases:[]});await job;assert.equal(p.config.value.applications.length,1);assert.equal(h.calls.filter(c=>c.method==='delete_application').length,1);
  }
});
test('PAM-20 Node/browser fingerprints agree despite object field order, including multimedia arguments',async t=>{
  const h=harness(t),{deletion}=mount(h);await settle();const c=learned();c.commandAliases[0].arguments={z:'été',a:'1'};
  for(const [kind,id]of [['application','fixture'],['formulation','phrase']]){
    const scope=deletion.deletionScope(c,kind,id),fingerprint=await deletion.deletionFingerprint(scope);
    const reorder=x=>Array.isArray(x)?x.map(reorder):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).reverse().map(([k,v])=>[k,reorder(v)])):x;
    assert.equal(fingerprint,nodeFingerprint(reorder(c),kind,id));
  }
});

async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'pam-deletion-'));t.after(async()=>{assert.equal(dirname(directory),tmpdir());assert.ok(basename(directory).startsWith('pam-deletion-'));await rm(directory,{recursive:true,force:true});});
  const executable=join(directory,'fixture.exe');await writeFile(executable,'Disposable fixture; never executed');
  const first={id:'11111111-1111-4111-8111-111111111111',name:'Premier',description:'Fixture',executable,arguments:[],aliases:['Mon éditeur'],enabled:true};
  const second={...first,id:'22222222-2222-4222-8222-222222222222',name:'Second',aliases:[]};
  const aliases=[{id:'33333333-3333-4333-8333-333333333333',phrase:'Ouvre mon premier',applicationId:first.id,action:'open'},{id:'44444444-4444-4444-8444-444444444444',phrase:'Ouvre mon second',applicationId:second.id,action:'open'}];
  const file=join(directory,'applications.json');await writeFile(file,JSON.stringify({...DEFAULT_CONFIG,applications:[first,second],commandAliases:aliases}));
  let effects=0;const handle=createAssistant({configDirectory:directory,runtimeDirectory:directory,runEngine:async()=>{effects++;throw Error('Forbidden');},launchApplication:async()=>{effects++;throw Error('Forbidden');}});
  return {directory,file,handle,first,second,aliases,effects:()=>effects};
}
test('PAM-20 real sidecar + UI + isolated profile: app and its learned phrases delete together; unrelated identities survive; double replay fails',async t=>{
  const f=await fixture(t),h=harness(t,{request:(m,p)=>f.handle(m,p)}),{p}=mount(h);await settle();await p.refresh();
  p.deleteApplication(p.config.value.applications[0]);await p.confirmDeletion();assert.equal(p.deletionError.value,'');
  const saved=JSON.parse(await readFile(f.file));assert.deepEqual(saved.applications,[f.second]);assert.deepEqual(saved.commandAliases,[f.aliases[1]]);
  assert.equal(saved.commandAliases.every(a=>saved.applications.some(app=>app.id===a.applicationId)),true);
  const bytes=await readFile(f.file,'utf8');await assert.rejects(f.handle('delete_application',{id:f.first.id}),/introuvable/);assert.equal(await readFile(f.file,'utf8'),bytes);assert.equal(f.effects(),0);
});
test('PAM-20 real sidecar refuses stale app and individual formulation scopes without touching disk; independent changes survive',async t=>{
  const f=await fixture(t);let c=(await f.handle('status')).config;const original=nodeFingerprint(c,'application',f.first.id),phrase=nodeFingerprint(c,'formulation',f.aliases[0].id);
  c.commandAliases[0].phrase='Nouvelle formulation';await writeFile(f.file,JSON.stringify(c));const changed=await readFile(f.file,'utf8');
  for(const [method,id,expectedFingerprint]of [['delete_application',f.first.id,original],['delete_command_alias',f.aliases[0].id,phrase]]){
    await assert.rejects(f.handle(method,{id,expectedFingerprint}),/a changé/);assert.equal(await readFile(f.file,'utf8'),changed);
  }
  const current=(await f.handle('status')).config,fp=nodeFingerprint(current,'formulation',f.aliases[0].id);
  current.applications[1].description='Autre modification';await writeFile(f.file,JSON.stringify(current));
  const result=await f.handle('delete_command_alias',{id:f.aliases[0].id,expectedFingerprint:fp});assert.deepEqual(result.commandAliases,[f.aliases[1]]);assert.equal(result.applications[1].description,'Autre modification');assert.deepEqual(result.applications[0],f.first);assert.equal(f.effects(),0);
});
test('PAM-20 repository persistence failure leaves app and phrases intact on disk and allows an explicit fresh attempt',async t=>{
  const f=await fixture(t),{editProfile}=require('../sidecar/assistant/config-repository.cjs'),{createConfigStore}=require('../sidecar/config-store.cjs');
  const before=await readFile(f.file,'utf8'),c=(await f.handle('status')).config;
  const store=createConfigStore(f.directory);
  // A real store write failure, using the same repository mutation path.
  const payload={id:f.first.id,expectedFingerprint:nodeFingerprint(c,'application',f.first.id)};
  await assert.rejects(editProfile('delete_application',payload,c,{saveConfig:v=>store.write(v,{beforeReplace:async()=>{throw Error('Disque fixture');}})}),/Disque fixture/);
  assert.equal(await readFile(f.file,'utf8'),before);
  const result=await f.handle('delete_application',payload);assert.deepEqual(result.applications,[f.second]);assert.deepEqual(result.commandAliases,[f.aliases[1]]);
});
