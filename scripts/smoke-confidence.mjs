// Pure inference: session capabilities and all execution hooks are fixtures.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const {createAssistant, toolsFor, DEFAULT_CONFIG} = require('../sidecar/assistant.cjs');
const {createEngine} = require('../sidecar/engine.cjs');
assert.equal(process.platform, 'win32', 'Ce test exécute la DLL Needle Windows.');
const bundle = process.argv[2] ? resolve(process.argv[2]) : null;
const {createAssistant: makeAssistant} = bundle ? require(join(bundle,'sidecar/assistant.cjs')) : {createAssistant};
const runtime = join(bundle || join(root,'src-tauri'), 'runtime');
const cache = join(root,'.runtime-cache');
await mkdir(cache,{recursive:true});
const profile = await mkdtemp(join(cache,'smoke-confidence-'));
const browser = {id:'541b3fad-0000-4000-8000-000000000000',name:'Navigateur Opera GX',aliases:['Opéra','le navigateur'],
  description:'Navigateur Internet',enabled:true,executable:'C:\\fixture-browser.exe',arguments:[],media:{sourceAppId:'opera.exe',deezer:false}};
const deezer = {...browser,id:'11111111-1111-4111-8111-111111111111',name:'Deezer',aliases:['Diseur'],media:{sourceAppId:'Deezer.exe',deezer:false}};
const ea = {...browser,id:'22222222-2222-4222-8222-222222222222',name:'EA',aliases:[],media:undefined};
const firefox = {...ea,id:'33333333-3333-4333-8333-333333333333',name:'Firefox',enabled:false};
const config = {...DEFAULT_CONFIG,autoExecute:true,applications:[browser,deezer,ea,firefox],confidenceThreshold:0.65};
const engine = createEngine(runtime);
const executions=[];
const positive = [
  ['Play sur le navigateur',browser.id,'media_play'],['Pause le navigateur',browser.id,'media_pause'],
  ['Piste suivante le navigateur',browser.id,'media_next'],['Piste précédente le navigateur',browser.id,'media_previous'],
  ['Stop le navigateur',browser.id,'media_stop'],['Joue Opéra',browser.id,'media_play'],['Pause Opéra',browser.id,'media_pause'],
  ['Joue sur Navigateur Opera GX',browser.id,'media_play'],['Pause Navigateur Opera GX',browser.id,'media_pause'],
  ['Play Diseur',deezer.id,'media_play'],['Pause Diseur',deezer.id,'media_pause'],
  ['Piste suivante Deezer',deezer.id,'media_next'],['Piste précédente Deezer',deezer.id,'media_previous'],
  ['Stop Deezer',deezer.id,'media_stop'],['Ouvre EA',ea.id,'open'],['Ouvre le navigateur',browser.id,'open'],
];
const negative = [
  'Ne joue pas sur le navigateur','Joue pas sur le navigateur','N’ouvre pas EA',"Don't play le navigateur",'Do not pause le navigateur',
  'Elle a dit : « Play sur le navigateur ».','He said "Play le navigateur".','« Play sur le navigateur »',
  'Play sur Firefox','Pause EA','Play sur Brave','Pause Firefox','Ne joue pas Deezer','N’ouvre pas le navigateur',
  'Ouvre EA et ne joue pas sur le navigateur','Play le navigateur but do not open EA',
];
const report = {date:new Date().toISOString(),runtime,checks:[]};
try {
  await writeFile(join(profile,'applications.json'),JSON.stringify(config));
  const legacy = toolsFor(config).find(tool=>tool.applicationId===browser.id&&tool.action==='media_play');
  const {name,description,triggers,parameters} = legacy;
  const toolsPath=join(profile,'baseline-tools.json'),systemPath=join(profile,'baseline-system.txt');
  await writeFile(toolsPath,JSON.stringify([{name,description,triggers,parameters}]));
  await writeFile(systemPath,"locale: fr\nplatform: Windows\nOnly use registered tools. Input values must come from the user's request. A Deezer content or search link only displays a page, never starts a song or adds it next in the queue. Skip next plays the next item already in the queue, never inserts a requested song. Reject requests to play a specific song or queue it next when no tool offers that behavior.\n");
  const baseline=JSON.parse((await engine.runEngine(join(runtime,'needle.exe'),['--model',join(runtime,'models/needle3.cact'),
    '--tools',toolsPath,'--system',systemPath,'--max','256','--fail-input-overflow','--prompt','Reprendre la lecture navigateur opera gx'],{timeout:40000})).stdout);
  assert.equal(baseline.function_calls.length,1);assert.equal(baseline.function_calls[0].name,name);
  report.baseline={confidence:baseline.confidence,correct:true};
  const handle=makeAssistant({configDirectory:profile,runtimeDirectory:runtime,runEngine:engine.runEngine,engine,
    media:{sessions:async()=>[browser,deezer].map(app=>({sourceAppId:app.media.sourceAppId,
      capabilities:{play:true,pause:true,next:true,previous:true,stop:true,toggle:true}})),
      execute:async(app,action)=>{executions.push({applicationId:app.id,action});return{success:true,message:'Fixture'};}},
    launchApplication:async app=>{executions.push({applicationId:app.id,action:'open'});return{success:true,message:'Fixture'};}});
  for(const [text,applicationId,action] of positive) {
    const before=executions.length,turn=await handle('process_text',{text});
    assert.equal(turn.transcript,text);assert.equal(turn.calls.length,1,text);assert.equal(turn.calls[0].applicationId,applicationId,text);
    assert.equal(turn.calls[0].action || 'open',action,text);
    const eligible=['open','media_play','media_pause'].includes(action);
    assert.equal(turn.status,eligible&&turn.confidence>=config.confidenceThreshold?'executed':'pending',text);
    assert.equal(executions.length-before,turn.status==='executed'?1:0,text);
    if(turn.status==='pending')await handle('discard',{id:turn.id});
    const check={text,expected:action,correct:true,confidence:turn.confidence,status:turn.status};report.checks.push(check);console.log(JSON.stringify(check));
  }
  for(const text of negative) {
    const before=executions.length,turn=await handle('process_text',{text});
    assert.equal(turn.status,'unsupported',text);assert.equal(turn.calls.length,0,text);assert.equal(executions.length,before,text);
    const check={text,expected:'unsupported',correct:true,confidence:turn.confidence,status:turn.status};report.checks.push(check);console.log(JSON.stringify(check));
  }
  const improved=report.checks.find(check=>check.text===positive[0][0]).confidence;
  assert.ok(improved>baseline.confidence,'Le score doit progresser pour la commande étudiée.');
  assert.ok(improved>=config.confidenceThreshold,'La commande étudiée doit franchir le seuil sans modifier le score.');
  report.aliasChecks=[];
  const corrected=await handle('correct_request',{id:browser.id,text:'Pose le navigateur',applicationId:browser.id,
    action:'media_pause',saveCommandAlias:true,commandPhrase:'Pose le navigateur'});
  assert.equal(corrected.status,'pending');assert.equal(corrected.confidence,null);assert.equal(corrected.calls[0].action,'media_pause');
  await handle('discard',{id:corrected.id});
  let learned=await handle('save_command_alias',{phrase:'Mais le film en pose',applicationId:browser.id,action:'media_pause'});
  for(const text of ['Pose le navigateur','Mais le film en pose']) {
    const turn=await handle('process_text',{text});assert.ok(turn.commandAliasId);assert.equal(turn.transcript,text);
    assert.equal(turn.calls.length,1);assert.equal(turn.calls[0].applicationId,browser.id);assert.equal(turn.calls[0].action,'media_pause');
    report.aliasChecks.push({text,action:'media_pause',confidence:turn.confidence,correct:true});
    if(turn.status==='pending')await handle('discard',{id:turn.id});
  }
  const held=await handle('process_text',{text:'Ne pose pas le navigateur'});
  assert.equal(held.status,'unsupported');assert.equal(held.calls.length,0);
  report.aliasChecks.push({text:held.transcript,action:'unsupported',confidence:held.confidence,correct:true});
  const alias=learned.commandAliases.find(alias=>alias.phrase==='Pose le navigateur');
  await handle('save_command_alias',{...alias,action:'media_play'});
  const changed=await handle('process_text',{text:alias.phrase});assert.equal(changed.calls[0].action,'media_play');
  report.aliasChecks.push({text:changed.transcript,action:'media_play after edit',confidence:changed.confidence,correct:true});
  if(changed.status==='pending')await handle('discard',{id:changed.id});
  learned=await handle('delete_command_alias',{id:alias.id});assert.ok(!learned.commandAliases.some(item=>item.id===alias.id));
  report.passed=true;report.realActionsExecuted=0;
  await mkdir(join(root,'artifacts'),{recursive:true});
  await writeFile(join(root,'artifacts/needle-confidence-results.json'),JSON.stringify(report,null,2));
  console.log(`Needle réel : ${positive.length+negative.length} cas corrects et ${report.aliasChecks.length} contrôles de formulations personnelles ; Play ${baseline.confidence} → ${improved}. Aucun lecteur réel contrôlé.`);
} finally {
  await engine.close();
  assert.equal(dirname(profile),cache);assert.ok(profile.startsWith(join(cache,'smoke-confidence-')));
  await rm(profile,{recursive:true,force:true});
}
