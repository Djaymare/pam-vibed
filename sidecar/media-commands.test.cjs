const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createAssistant,DEFAULT_CONFIG}=require('./assistant.cjs');
const {parseMediaAction,resolveMediaCommand}=require('./media-commands.cjs');
const {DEEZER_APP_ID}=require('./deezer.cjs');
const deezer={id:'11111111-1111-4111-8111-111111111111',name:'Deezer Music',aliases:['Diseur','Deezer'],description:'Musique',enabled:true,
  executable:'C:\\fixture.exe',arguments:[],windowsApp:{appId:DEEZER_APP_ID,kind:'store',icon:null},media:{sourceAppId:'Deezer.exe',deezer:true}};
const browser={...deezer,id:'22222222-2222-4222-8222-222222222222',name:'Navigateur Opera GX',aliases:['le navigateur'],windowsApp:undefined,media:{sourceAppId:'opera.exe',deezer:false}};
const ea={...browser,id:'33333333-3333-4333-8333-333333333333',name:'EA',aliases:[],media:undefined};
const config={...DEFAULT_CONFIG,applications:[deezer,browser,ea],autoExecute:false};
const session=app=>({sourceAppId:app.media.sourceAppId,capabilities:{play:true,pause:true,next:true,previous:true,stop:true,toggle:true}});
const named=[
  ['Diseur prochain piste.','media_next'],['Prochaine piste sur Diseur','media_next'],['Diseur piste suivante.','media_next'],
  ['Piste suivant sur Diseur.','media_next'],['Diseur, prochaines chansons !','media_next'],['Passe à la chanson suivante dans Deezer','media_next'],
  ['Mais Diseur empose.','media_pause'],['Mais pose sur Diseur.','media_pause'],['Mets Deezer en pause','media_pause'],['Pose Diseur','media_pause'],
  ['Diseur : mets en pause','media_pause'],['Pause le média dans Diseur','media_pause'],['Diseur piste précédente','media_previous'],
  ['Précédente chanson sur Deezer','media_previous'],['Diseur reprends la lecture','media_play'],['Stop la musique dans Deezer','media_stop'],
  ['Diseur bascule lecture / pause','media_toggle'],
];
async function fixture(t,options={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pam-media-commands-test-'));
  t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('pam-media-commands-test-'));await fs.rm(directory,{recursive:true,force:true});});
  const c={...structuredClone(config),...options.config},requests=[],executions=[];
  await fs.writeFile(path.join(directory,'applications.json'),JSON.stringify(c));
  const handle=createAssistant({configDirectory:directory,runtimeDirectory:directory,
    media:{sessions:async()=>options.sessions ?? [session(deezer),session(browser)],execute:async(app,action)=>{executions.push({id:app.id,action});return {success:true};}},
    launchApplication:async app=>{executions.push({id:app.id,action:'open'});return {success:true};},
    runEngine:async(_file,args)=>{
      if(!args.includes('--tools'))return {stdout:JSON.stringify({text:options.speechText,language:'fr'})};
      const tools=JSON.parse(await fs.readFile(args[args.indexOf('--tools')+1],'utf8'));
      requests.push({tools,prompt:args[args.indexOf('--prompt')+1]});
      return {stdout:JSON.stringify(options.response || {confidence:0.8234,function_calls:[{name:tools[0].name,arguments:{}}]})};
    }});
  return {handle,requests,executions,directory};
}
test('les changements de piste et les pauses des captures fixent leur action et leur lecteur',async t=>{
  const f=await fixture(t);
  for(const [text,action] of named) {
    const turn=await f.handle('process_text',{text});
    assert.equal(turn.status,'pending',text);assert.equal(turn.calls.length,1,text);assert.equal(turn.calls[0].applicationId,deezer.id,text);
    assert.equal(turn.calls[0].action,action,text);assert.deepEqual(turn.calls[0].arguments,{});assert.equal(turn.transcript,text);assert.equal(turn.confidence,0.8234);
    assert.equal(f.requests.at(-1).tools.length,1,text);await f.handle('discard',{id:turn.id});
  }
  assert.equal(f.executions.length,0);
});
test('une pause reste une pause ; seules les demandes explicites d’arrêt deviennent stop',()=>{
  for(const text of ['Mais le média en pause','Mets le film en pose','Pauiser','Pose','Mais empose','Pause la musique'])assert.equal(parseMediaAction(text),'media_pause',text);
  for(const text of ['Arrête la musique','Stop','Arrêter le média'])assert.equal(parseMediaAction(text),'media_stop',text);
  for(const text of ['Pour ça','Tous médias','Ne mets pas en pause','Elle a dit « pause »','pause et ouvre EA'])assert.equal(parseMediaAction(text),null,text);
});
test('sans nom, la seule session configurée choisit le lecteur, même en pause',async t=>{
  const phrases=['Prochaine piste','Prochaine chanson','Passe la chanson','Mais le média en pause','Pause le média','Pauiser','Lecture','Piste précédente','Stop','Bascule lecture / pause'];
  for(const app of [deezer,browser]) {
    const f=await fixture(t,{sessions:[{...session(app),playbackStatus:'paused'}]});
    for(const text of phrases) {
      const turn=await f.handle('process_text',{text});assert.equal(turn.status,'pending',text);
      assert.equal(turn.calls[0].applicationId,app.id,text);assert.equal(turn.calls[0].action,parseMediaAction(text),text);
      await f.handle('discard',{id:turn.id});
    }
    assert.equal(f.executions.length,0);
  }
});
test('sans nom, plusieurs lecteurs ou aucune session demandent de préciser avant Needle',async t=>{
  for(const sessions of [[],[session(deezer),session(browser)],[session(deezer),session(deezer)]]) {
    const f=await fixture(t,{sessions});
    for(const text of ['Prochaine piste','Passe la chanson','Mais le média en pause']) {
      const turn=await f.handle('process_text',{text});assert.equal(turn.status,'unsupported');assert.equal(turn.calls.length,0);assert.equal(turn.confidence,null);
      assert.match(turn.message,sessions.length ? /Plusieurs/ : /Aucun lecteur/);
    }
    assert.equal(f.requests.length,0);assert.equal(f.executions.length,0);
  }
});
test('une capacité manquante ne sélectionne ni stop, ni ouverture, ni un autre lecteur',async t=>{
  const unpausable={...session(deezer),capabilities:{...session(deezer).capabilities,pause:false}};
  const f=await fixture(t,{sessions:[unpausable]});
  for(const text of ['Mets Deezer en pause','Pause le média']) {
    const turn=await f.handle('process_text',{text});assert.equal(turn.status,'unsupported');assert.match(turn.message,/ne propose actuellement pas/);
  }
  assert.equal(f.requests.length,0);assert.equal(f.executions.length,0);
  const ambiguous=await fixture(t,{sessions:[unpausable,session(browser)]});
  const turn=await ambiguous.handle('process_text',{text:'Pause'});assert.match(turn.message,/Plusieurs lecteurs/);assert.equal(ambiguous.requests.length,0);
});
test('un lecteur nommé, inconnu, partagé, inactif ou sans multimédia ne devient pas EA',async t=>{
  for(const text of ['Pose des heures','Pose sur dix heures','Pause au Dieu','Des heures prochaines pistes','Pause EA']) {
    const f=await fixture(t);const turn=await f.handle('process_text',{text});assert.equal(turn.status,'unsupported',text);assert.equal(turn.calls.length,0);
    assert.equal(f.requests.length,0);assert.equal(f.executions.length,0);
  }
  const shared={...config,applications:[deezer,{...browser,aliases:['Diseur']}]};
  assert.match(resolveMediaCommand('Diseur prochaine piste',shared,[]).issue,/plusieurs applications/);
  const disabled={...config,applications:[{...deezer,enabled:false},browser]};
  assert.match(resolveMediaCommand('Diseur prochaine piste',disabled,[]).issue,/actives/);
  const duplicateDisabled={...config,applications:[deezer,{...browser,aliases:['Diseur'],enabled:false}]};
  assert.equal(resolveMediaCommand('Diseur prochaine piste',duplicateDisabled,[]).applicationId,deezer.id);
});
test('une ouverture inventée pour « Tous médias » ou « Pour ça » est refusée même à 99 %',async t=>{
  for(const response of [
    {confidence:0.99,function_calls:[{name:'open_ea',arguments:{}}]},
    {confidence:0.99,function_calls:[{name:'stop_deezer_music',arguments:{}}]},
  ]) {
    const f=await fixture(t,{response});
    for(const text of ['Tous médias.','Pour ça']) {
      const turn=await f.handle('process_text',{text});assert.equal(turn.status,'unsupported');assert.equal(turn.calls.length,0);assert.equal(turn.confidence,0.99);
    }
    assert.equal(f.executions.length,0);
  }
});
test('une formulation reconnue interdit un autre lecteur, une autre action, des paramètres et les doublons',async t=>{
  for(const calls of [
    [{name:'pause_opera_gx',arguments:{}}],[{name:'stop_deezer_music',arguments:{}}],
    [{name:'pause_deezer_music',arguments:{input:'inventé'}}],
    [{name:'pause_deezer_music',arguments:{}},{name:'pause_deezer_music',arguments:{}}],
  ]) {
    const f=await fixture(t,{response:{confidence:0.99,function_calls:calls}});
    await assert.rejects(f.handle('process_text',{text:'Mais Diseur empose'}));assert.equal(f.executions.length,0);
  }
});
test('les erreurs de transcription apprises restent des phrases entières et gardent le score brut en vocal',async t=>{
  const text='Des heures prochaines pistes';
  const f=await fixture(t,{speechText:text});
  for(const [phrase,action] of [[text,'media_next'],['Pose sur dix heures','media_pause'],['Pour ça','media_pause']])
    await f.handle('save_command_alias',{phrase,applicationId:deezer.id,action});
  const typed=await f.handle('process_text',{text});
  const {encodeWav}=await import('../src/audio/wav.ts');
  const voice=await f.handle('process_audio',{audio:Array.from(encodeWav(new Float32Array(16000)))});
  assert.ok(voice.commandAliasId);assert.equal(voice.transcript,text);assert.equal(voice.confidence,0.8234);assert.deepEqual(voice.calls,typed.calls);
  for(const phrase of ['Pose sur dix heures','Pour ça']) {
    const turn=await f.handle('process_text',{text:phrase});assert.equal(turn.calls[0].action,'media_pause');assert.equal(turn.calls[0].applicationId,deezer.id);
  }
  const other=await f.handle('process_text',{text:'Pose sur dix heures et ouvre EA'});assert.equal(other.commandAliasId,undefined);
  assert.equal(f.executions.length,0);
});
test('les négations et citations gardent leurs protections ; les phrases libres restent intactes',async t=>{
  const f=await fixture(t,{response:{confidence:0.99,function_calls:[{name:'next_deezer_music',arguments:{}}]}});
  for(const text of ['Diseur ne passe pas à la prochaine piste','Diseur passe pas à la prochaine piste','Pause pas Diseur','Ne passe pas la chanson','Diseur « prochaine piste »','Elle a dit « prochaine piste sur Diseur »']) {
    const turn=await f.handle('process_text',{text});assert.equal(turn.status,'unsupported');assert.equal(turn.calls.length,0);assert.equal(f.requests.at(-1).prompt,text);
  }
  assert.equal(f.executions.length,0);
  assert.deepEqual(resolveMediaCommand('Joue de la musique dans le navigateur',config),{});
  assert.deepEqual(resolveMediaCommand('Diseur prochaine piste et ouvre EA',config),{});
});
test('les nouveaux changements de piste natifs ne peuvent être mémorisés pour une autre action',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.handle('save_command_alias',{phrase:'Diseur prochaine piste',applicationId:deezer.id,action:'media_play'}),/autre action/);
  await assert.rejects(f.handle('save_command_alias',{phrase:'Mets Deezer en pause',applicationId:deezer.id,action:'media_stop'}),/autre action/);
  await f.handle('save_command_alias',{phrase:'Mais Diseur empose',applicationId:deezer.id,action:'media_pause'});
});
test('une application nommée Pause garde son lancement, et le choix manuel résout un nom partagé',async t=>{
  const pause={...ea,name:'Pause'};
  const f=await fixture(t,{config:{applications:[deezer,pause]},sessions:[session(deezer)]});
  const turn=await f.handle('process_text',{text:'Pause'});assert.equal(turn.calls[0].action || 'open','open');assert.equal(turn.calls[0].applicationId,pause.id);
  const shared=await fixture(t,{config:{applications:[deezer,{...browser,aliases:['Diseur']}]}});
  const corrected=await shared.handle('correct_request',{id:deezer.id,text:'Diseur prochaine piste',applicationId:browser.id});
  assert.equal(corrected.status,'pending');assert.equal(corrected.calls[0].applicationId,browser.id);assert.equal(corrected.calls[0].action,'media_next');
});
