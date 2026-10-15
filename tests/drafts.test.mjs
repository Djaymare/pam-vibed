import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, deferred, settle, config, status, turn } from './fixtures/vue-harness.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { createRequire } from 'node:module';
const { createAssistant, DEFAULT_CONFIG } = createRequire(import.meta.url)('../sidecar/assistant.cjs');

function application(h) {
  return h.mount((load,v)=>{
    const page=v.ref('assistant');let p;
    p=load('composables/useProfile.ts').useProfile(h.request,()=>p?.busy.value??false,()=>{},()=>page.value);
    const proposals=load('composables/useProposals.ts').useProposals(p,()=>p.busy.value,()=>{});
    const editor=load('composables/useApplicationEditor.ts').useApplicationEditor(p,()=>{});
    return {page,profile:p,proposals,editor,guard:load('composables/useDraftGuard.ts').useDraftGuard()};
  }).value;
}
test('PAM-19 unchanged editor closes immediately; changed draft requires an explicit discard, Escape keeps it',async t=>{
  const h=harness(t),f=application(h);await settle();f.editor.editApplication();
  assert.equal(f.editor.dirty.value,false);
  const close=()=>f.guard.run(f.editor.dirty.value,()=>{f.editor.editorOpen.value=false;});
  close();assert.equal(f.editor.editorOpen.value,false);assert.equal(f.guard.pending.value,false);
  f.editor.editApplication();f.editor.form.description='  Une longue saisie\n'+ 'é'.repeat(200);
  close();assert.equal(f.guard.pending.value,true);assert.equal(f.editor.editorOpen.value,true);
  f.guard.keep();assert.equal(f.editor.form.description,'  Une longue saisie\n'+'é'.repeat(200));
  close();f.guard.discard();assert.equal(f.editor.editorOpen.value,false);
});
test('PAM-19 application save and engine failures preserve every draft field exactly',async t=>{
  const h=harness(t,{request:m=>['save_application','test_application'].includes(m)?Promise.reject(Error('Erreur fixture')):undefined});
  const f=application(h);await settle();f.editor.editApplication();
  Object.assign(f.editor.form,{name:'Longue saisie',description:'  é\n'.repeat(60),executable:'fixture.exe',aliases:' Un, deux ',arguments:'["{input}"]'});
  f.editor.testInput.value='  Un texte de test  ';const before=JSON.stringify(f.editor.form);
  await f.editor.saveApplication();await f.editor.testLaunch();
  assert.equal(JSON.stringify(f.editor.form),before);assert.equal(f.editor.testInput.value,'  Un texte de test  ');
  assert.equal(f.editor.editorOpen.value,true);assert.match(f.editor.formError.value,/Erreur fixture/);
});
test('PAM-19 preferences keep attempted values after save failure, refresh and navigation; retry saves once',async t=>{
  let fail=true,saved=config();const h=harness(t,{request(m,p){if(m==='settings'){if(fail)return Promise.reject(Error('Sauvegarde fixture'));saved={...saved,...p};return Promise.resolve(saved);}if(m==='status')return Promise.resolve({...status(),config:saved});}});
  const f=application(h);await settle();Object.assign(f.profile.settingsDraft,{language:'en',autoExecute:false,confidenceThreshold:0.85});
  await f.profile.saveSettings();f.page.value='settings';await f.profile.refresh();
  assert.deepEqual({...f.profile.settingsDraft},{language:'en',autoExecute:false,confidenceThreshold:0.85});
  assert.equal(f.profile.config.value.language,'fr');assert.equal(f.profile.settingsDirty.value,true);assert.match(f.profile.settingsError.value,/Sauvegarde fixture/);
  fail=false;await f.profile.saveSettings();assert.equal(f.profile.settingsDirty.value,false);assert.equal(saved.language,'en');
});
test('PAM-19 stale preferences save does not mark the retained draft as saved',async t=>{
  const pending=deferred(),h=harness(t,{request:m=>m==='settings'?pending.promise:undefined});const f=application(h);await settle();
  f.profile.settingsDraft.language='en';const save=f.profile.saveSettings();f.page.value='settings';pending.resolve({...config(),language:'en'});await save;
  assert.equal(f.profile.settingsDirty.value,true);assert.equal(f.profile.settingsDraft.language,'en');
});
test('PAM-19 correction: learning succeeds, inference fails, retry never repeats learning',async t=>{
  let saved=config(),writes=0,inferences=0;
  const h=harness(t,{request(m,p){
    if(m==='status')return Promise.resolve({...status(),config:structuredClone(saved)});
    if(m==='correct_request'){inferences++;if(p.saveAlias){writes++;saved.applications[0].aliases.push(p.alias);}assert.equal(p.saveCommandAlias,false);return inferences===1?Promise.reject(Error('Moteur fixture')):Promise.resolve(turn('corrected'));}
  }});
  const f=application(h);await settle();f.proposals.editTurn(turn());
  Object.assign(f.proposals.correctionForm,{text:'  Une longue correction\n'+'é'.repeat(500),applicationId:'fixture',saveAlias:true,alias:'Mon test'});
  const before=JSON.stringify(f.proposals.correctionForm);await f.proposals.correctTurn();
  assert.equal(f.proposals.correctionSaved.value,true);assert.equal(f.proposals.correctionStage.value,'inference');assert.match(f.proposals.correctionError.value,/Moteur fixture/);
  assert.equal(JSON.stringify(f.proposals.correctionForm),before);assert.ok(f.proposals.correction.value);
  await f.proposals.correctTurn();assert.equal(writes,1);assert.equal(inferences,2);assert.equal(f.proposals.correction.value,undefined);
});
test('PAM-19 correction: uncertain formulation save is reconciled before retry, retaining one ID',async t=>{
  let saved=config(),writes=0;
  const h=harness(t,{request(m,p){
    if(m==='status')return Promise.resolve({...status(),config:structuredClone(saved)});
    if(m==='correct_request'){if(p.saveCommandAlias){writes++;saved.commandAliases=[{phrase:p.commandPhrase,applicationId:p.applicationId,action:p.action,id:'stable-id'}];return Promise.reject(Error('Réponse perdue'));}return Promise.resolve(turn('corrected'));}
  }});
  const f=application(h);await settle();f.proposals.editTurn(turn());Object.assign(f.proposals.correctionForm,{text:'Ma demande',applicationId:'fixture',action:'open',saveCommandAlias:true,commandPhrase:'Ouvre le test personnel'});
  await f.proposals.correctTurn();assert.match(f.proposals.correctionError.value,/Réponse perdue/);assert.ok(f.proposals.correction.value);
  await f.proposals.correctTurn();assert.equal(writes,1);assert.equal(saved.commandAliases.length,1);assert.equal(saved.commandAliases[0].id,'stable-id');
});
test('PAM-19 correction: a resolved failed turn retains the complete form and partial success',async t=>{
  const h=harness(t,{request:m=>m==='correct_request'?Promise.resolve({...turn(),status:'failed',message:'Moteur fixture'}):undefined});
  const f=application(h);await settle();f.proposals.editTurn(turn());f.proposals.correctionForm.text='Une saisie à conserver';
  await f.proposals.correctTurn();assert.ok(f.proposals.correction.value);assert.equal(f.proposals.correctionForm.text,'Une saisie à conserver');assert.match(f.proposals.correctionError.value,/Moteur fixture/);
});
test('PAM-19 real sidecar: saved alias survives inference failure; UI retry preserves native checks and never duplicates',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pam-draft-'));
  t.after(async()=>{assert.equal(dirname(directory),tmpdir());assert.ok(basename(directory).startsWith('pam-draft-'));await rm(directory,{recursive:true,force:true});});
  const executable=join(directory,'fixture.exe');await writeFile(executable,'Disposable fixture; never executed');
  const app={id:'11111111-1111-4111-8111-111111111111',name:'Editeur fixture',description:'Test',executable,aliases:[],arguments:[],enabled:true};
  await writeFile(join(directory,'applications.json'),JSON.stringify({...DEFAULT_CONFIG,applications:[app],autoExecute:false}));
  let fail=true,executions=0;
  const handle=createAssistant({configDirectory:directory,runtimeDirectory:directory,launchApplication:async()=>{executions++;throw Error('No launch allowed');},runEngine:async(_file,args)=>{
    if(fail)throw Error('Moteur fixture indisponible');
    const tools=JSON.parse(await readFile(args[args.indexOf('--tools')+1],'utf8'));
    return {stdout:JSON.stringify({confidence:0.9,function_calls:[{name:tools[0].name,arguments:{}}]})};
  }});
  const h=harness(t,{request:(method,payload)=>handle(method,payload)}),f=application(h);await settle();await f.profile.refresh();
  const old=await handle('prepare_action',{applicationId:app.id,action:'open'});f.proposals.add(old);f.proposals.editTurn(old);
  Object.assign(f.proposals.correctionForm,{text:'Ouvre Mon test',applicationId:app.id,saveAlias:true,alias:'Mon test'});
  await f.proposals.correctTurn();assert.equal(f.proposals.correctionSaved.value,true);assert.ok(f.proposals.correction.value);
  assert.deepEqual((await handle('status')).config.applications[0].aliases,['Mon test']);
  fail=false;await f.proposals.correctTurn();
  assert.equal(f.proposals.correction.value,undefined);assert.equal(f.proposals.turns.value[0].status,'pending');
  assert.deepEqual((await handle('status')).config.applications[0].aliases,['Mon test']);
  assert.deepEqual(h.calls.filter(c=>c.method==='correct_request').map(c=>c.payload.saveAlias),[true,false]);
  assert.equal(h.calls.some(c=>['save_application','save_command_alias'].includes(c.method)),false);
  assert.equal(executions,0);
});
