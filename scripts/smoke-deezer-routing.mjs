// Real Needle inference, isolated profile, no player or application execution.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const bundle=process.argv[2] ? resolve(process.argv[2]) : null;
const source=bundle || root;
const {createAssistant,toolsFor,DEFAULT_CONFIG}=require(join(source,'sidecar/assistant.cjs'));
const {createEngine}=require(join(source,'sidecar/engine.cjs'));
const {needleTools}=require(join(source,'sidecar/needle-tools.cjs'));
const {DEEZER_APP_ID}=require(join(source,'sidecar/deezer.cjs'));
assert.equal(process.platform,'win32');
const runtime=join(bundle || join(root,'src-tauri'),'runtime'),cache=join(root,'.runtime-cache');
await mkdir(cache,{recursive:true});
const profile=await mkdtemp(join(cache,'smoke-deezer-routing-'));
const engine=createEngine(runtime);
const deezer={id:'11111111-1111-4111-8111-111111111111',name:'Deezer Music',aliases:['Diseur','Deezer'],description:'Écoute de musique',enabled:true,
  executable:'C:\\fixture.exe',arguments:[],windowsApp:{appId:DEEZER_APP_ID,kind:'store',icon:null},media:{sourceAppId:'Deezer.exe',deezer:true}};
const browser={...deezer,id:'22222222-2222-4222-8222-222222222222',name:'Opera GX',aliases:['Navigateur'],windowsApp:undefined,media:{sourceAppId:'opera.exe',deezer:false}};
const config={...DEFAULT_CONFIG,applications:[deezer,browser],autoExecute:false};
const report={date:new Date().toISOString(),runtime,baseline:[],checks:[],realActionsExecuted:0};
const cases=[
  ['Démarrer Flow dans Diseur.','deezer_start',{mix:'flow'}],['Lance Flow dans Deezer Music','deezer_start',{mix:'flow'}],
  ['Lire les coups de cœur dans Diseur','deezer_start',{mix:'loved_tracks'}],['Lire les coups de coeur dans Diseur','deezer_start',{mix:'loved_tracks'}],
  ['Lire les coûts de cœur dans Diseur','deezer_start',{mix:'loved_tracks'}],
  ['Rechercher Dave Pink dans Diseur.','deezer_search',{query:'Dave Pink'}],['Rechercher Daft Punk dans Deezer','deezer_search',{query:'Daft Punk'}],
  ['Rechercher Été / Ça va? dans Diseur','deezer_search',{query:'Été / Ça va?'}],
  ...Object.entries({chanson:'track',album:'album',artiste:'artist',playlist:'playlist',podcast:'show',épisode:'episode',profil:'profile'})
    .map(([kind,value])=>[`Afficher ${kind} 3135556 dans Diseur`,'deezer_content',{kind:value,id:'3135556'}]),
  ['Afficher la chanson 1234567890123456789 dans Deezer Music','deezer_content',{kind:'track',id:'1234567890123456789'}],
  ...Object.entries({accueil:'home',podcasts:'podcasts',Explorer:'explore',classements:'charts',ambiances:'moods',radios:'radios','réglages audio':'audio_settings',apparence:'theme'})
    .map(([page,value])=>[`Afficher la page ${page} dans Diseur`,'deezer_page',{page:value}]),
  ['Affiche l’accueil dans Deezer','deezer_page',{page:'home'}],['Affiche les réglages d’apparence dans Deezer','deezer_page',{page:'theme'}],
  ['Recharge Diseur','deezer_reload',{}],
  ['Affiche la sélection smarttracklist Test_123-AbC dans Deezer','deezer_smarttracklist',{id:'Test_123-AbC',mode:'display'}],
  ['Démarre la sélection smarttracklist Test_123-AbC dans Deezer','deezer_smarttracklist',{id:'Test_123-AbC',mode:'play'}],
  ['Bascule lecture pause dans Deezer','media_toggle',{}],
];
try {
  await writeFile(join(profile,'applications.json'),JSON.stringify(config));
  const system=join(profile,'system.txt');
  await writeFile(system,"locale: fr\nplatform: Windows\nOnly use registered tools. Input values must come from the user's request. A Deezer content or search link only displays a page, never starts a song or adds it next in the queue. Skip next plays the next item already in the queue, never inserts a requested song. Reject requests to play a specific song or queue it next when no tool offers that behavior.\n");
  for(const [text,action] of [cases[0],cases[4],cases[5]]) {
    const tools=toolsFor(config).filter(tool=>text.includes('coûts') || tool.applicationId===deezer.id && tool.action===action);
    const file=join(profile,'baseline-tools.json');await writeFile(file,JSON.stringify(needleTools(tools,config)));
    try {
      const result=JSON.parse((await engine.runEngine(join(runtime,'needle.exe'),['--tools',file,'--system',system,'--prompt',text],{timeout:40000})).stdout);
      report.baseline.push({text,confidence:result.confidence,calls:result.function_calls || result.suppressed_calls});
    } catch(error) {report.baseline.push({text,error:error.message});}
  }
  const handle=createAssistant({configDirectory:profile,runtimeDirectory:runtime,runEngine:engine.runEngine,engine,
    media:{sessions:async()=>[deezer,browser].map(app=>({sourceAppId:app.media.sourceAppId,capabilities:{play:true,pause:true,next:true,previous:true,stop:true,toggle:true}})),execute:async()=>{throw new Error('No real execution permitted');}},
    launchApplication:async()=>{throw new Error('No real launch permitted');}});
  for(const [text,action,args] of cases) {
    const turn=await handle('process_text',{text});
    assert.equal(turn.transcript,text);assert.equal(turn.status,'pending',text);assert.equal(turn.calls.length,1,text);
    assert.equal(turn.calls[0].applicationId,deezer.id,text);assert.equal(turn.calls[0].action,action,text);assert.deepEqual(turn.calls[0].arguments,args,text);
    await handle('discard',{id:turn.id});
    const item={text,action,args,confidence:turn.confidence,correct:true};report.checks.push(item);console.log(JSON.stringify(item));
  }
  await handle('save_command_alias',{phrase:'Rechercher Dave Pink dans Diseur',applicationId:deezer.id,action:'deezer_search',arguments:{query:'Daft Punk'}});
  const learned=await handle('process_text',{text:'Rechercher Dave Pink dans Diseur.'});assert.ok(learned.commandAliasId);
  assert.deepEqual(learned.calls[0].arguments,{query:'Daft Punk'});await handle('discard',{id:learned.id});
  report.checks.push({text:learned.transcript,action:'deezer_search',args:learned.calls[0].arguments,confidence:learned.confidence,learned:true,correct:true});
  for(const text of ['Ne démarre pas Flow dans Diseur','Elle a dit « Démarrer Flow dans Diseur »','Lire les coûts de cœur dans Opera GX',
    'Joue la chanson 3135556 dans Diseur','Ajoute la chanson 3135556 dans la file en prochaine position sur Diseur']) {
    const turn=await handle('process_text',{text});assert.equal(turn.status,'unsupported',text);assert.equal(turn.calls.length,0,text);
    report.checks.push({text,action:'unsupported',confidence:turn.confidence,correct:true});
  }
  report.passed=true;await mkdir(join(root,'artifacts'),{recursive:true});
  await writeFile(join(root,'artifacts/deezer-routing-results.json'),JSON.stringify(report,null,2));
  console.log(`Deezer Needle réel : ${report.checks.length} contrôles corrects. Aucun lecteur personnel commandé.`);
} finally {
  await engine.close();assert.equal(dirname(profile),cache);assert.ok(profile.startsWith(join(cache,'smoke-deezer-routing-')));
  await rm(profile,{recursive:true,force:true});
}
