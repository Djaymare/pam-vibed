// Real Needle inference with isolated configuration and fixture sessions only.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const bundle=process.argv[2] ? resolve(process.argv[2]) : null;
const {createAssistant,DEFAULT_CONFIG}=require(join(bundle || root,'sidecar/assistant.cjs'));
const {createEngine}=require(join(bundle || root,'sidecar/engine.cjs'));
const {DEEZER_APP_ID}=require(join(bundle || root,'sidecar/deezer.cjs'));
assert.equal(process.platform,'win32');
const runtime=join(bundle || join(root,'src-tauri'),'runtime'),cache=join(root,'.runtime-cache');
await mkdir(cache,{recursive:true});
const profile=await mkdtemp(join(cache,'smoke-media-commands-')),engine=createEngine(runtime);
const deezer={id:'11111111-1111-4111-8111-111111111111',name:'Deezer Music',aliases:['Diseur','Deezer'],description:'Musique',enabled:true,
  executable:'C:\\Windows\\explorer.exe',arguments:[`shell:AppsFolder\\${DEEZER_APP_ID}`],windowsApp:{appId:DEEZER_APP_ID,kind:'store',icon:null},media:{sourceAppId:'Deezer.exe',deezer:true}};
const browser={...deezer,id:'22222222-2222-4222-8222-222222222222',name:'Navigateur Opera GX',aliases:['le navigateur'],windowsApp:undefined,media:{sourceAppId:'opera.exe',deezer:false}};
const ea={...browser,id:'33333333-3333-4333-8333-333333333333',name:'EA',aliases:[],media:undefined};
const session=app=>({sourceAppId:app.media.sourceAppId,playbackStatus:'paused',capabilities:{play:true,pause:true,next:true,previous:true,stop:true,toggle:true}});
let sessions=[session(deezer),session(browser)];
const report={date:new Date().toISOString(),runtime,checks:[],realActionsExecuted:0};
const named=[
  ['Diseur prochain piste.','media_next'],['Prochaine piste sur Diseur','media_next'],['Diseur piste suivante.','media_next'],
  ['Piste suivant sur Diseur.','media_next'],['Diseur, prochaines chansons !','media_next'],['Passe à la chanson suivante dans Deezer','media_next'],
  ['Mais Diseur empose.','media_pause'],['Mais pose sur Diseur.','media_pause'],['Mets Deezer en pause','media_pause'],['Pose Diseur','media_pause'],
  ['Diseur : mets en pause','media_pause'],['Pause le média dans Diseur','media_pause'],['Diseur piste précédente','media_previous'],
  ['Précédente chanson sur Deezer','media_previous'],['Diseur reprends la lecture','media_play'],['Stop la musique dans Deezer','media_stop'],
  ['Diseur bascule lecture / pause','media_toggle'],['Mais le navigateur en pause','media_pause',browser.id],
];
const unnamed=[['Prochaine piste','media_next'],['Prochaine chanson','media_next'],['Passe la chanson','media_next'],
  ['Mais le média en pause','media_pause'],['Pause le média','media_pause'],['Pauiser','media_pause'],['Lecture','media_play'],
  ['Piste précédente','media_previous'],['Stop','media_stop'],['Bascule lecture / pause','media_toggle']];
try {
  await writeFile(join(profile,'applications.json'),JSON.stringify({...DEFAULT_CONFIG,applications:[deezer,browser,ea],autoExecute:false}));
  const handle=createAssistant({configDirectory:profile,runtimeDirectory:runtime,runEngine:engine.runEngine,engine,
    media:{sessions:async()=>sessions,execute:async()=>{throw new Error('No real media execution permitted');}},
    launchApplication:async()=>{throw new Error('No real launch permitted');}});
  async function check(text,action,applicationId=deezer.id,context='named') {
    const turn=await handle('process_text',{text});assert.equal(turn.transcript,text);
    if(action==='unsupported') {
      assert.equal(turn.status,'unsupported',text);assert.equal(turn.calls.length,0,text);
    } else {
      assert.equal(turn.status,'pending',text);assert.equal(turn.calls.length,1,text);assert.equal(turn.calls[0].applicationId,applicationId,text);
      assert.equal(turn.calls[0].action,action,text);assert.deepEqual(turn.calls[0].arguments,{},text);
      await handle('discard',{id:turn.id});
    }
    const item={text,context,action,applicationId:action==='unsupported'?null:applicationId,confidence:turn.confidence,message:turn.message,correct:true};
    report.checks.push(item);console.log(JSON.stringify(item));return turn;
  }
  for(const [text,action,applicationId] of named)await check(text,action,applicationId);
  for(const [text] of unnamed) {
    const turn=await check(text,'unsupported',undefined,'two active players');assert.match(turn.message,/Plusieurs lecteurs/);assert.equal(turn.confidence,null);
  }
  for(const text of ['Pose des heures.','Pose sur dix heures.','Pause au Dieu.','Des heures prochaines pistes','Tous médias.','Pour ça',
    'Ne passe pas la chanson','Diseur ne passe pas à la prochaine piste','Diseur passe pas à la prochaine piste','Pause pas Diseur','Diseur « prochaine piste »','Joue la chanson 3135556 dans Diseur'])
    await check(text,'unsupported',undefined,'unknown or guarded');
  for(const app of [deezer,browser]) {
    sessions=[session(app)];
    for(const [text,action] of unnamed)await check(text,action,app.id,'one active player');
  }
  sessions=[{...session(deezer),capabilities:{...session(deezer).capabilities,pause:false}}];
  const unavailable=await check('Mais le média en pause','unsupported',undefined,'missing capability');assert.match(unavailable.message,/ne propose actuellement pas/);
  sessions=[];
  const absent=await check('Prochaine piste','unsupported',undefined,'no active player');assert.match(absent.message,/Aucun lecteur/);
  sessions=[session(deezer),session(browser)];
  for(const [text,action] of [['Des heures prochaines pistes','media_next'],['Pose sur dix heures','media_pause'],['Pour ça','media_pause']]) {
    await handle('save_command_alias',{phrase:text,applicationId:deezer.id,action});
    const turn=await check(text,action,deezer.id,'personal command alias');assert.ok(turn.commandAliasId);
  }
  report.passed=true;await mkdir(join(root,'artifacts'),{recursive:true});
  await writeFile(join(root,'artifacts/media-commands-results.json'),JSON.stringify(report,null,2));
  console.log(`Needle réel : ${report.checks.length} contrôles média corrects. Aucun lecteur personnel commandé.`);
} finally {
  await engine.close();assert.equal(dirname(profile),cache);assert.ok(profile.startsWith(join(cache,'smoke-media-commands-')));
  await rm(profile,{recursive:true,force:true});
}
