const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createAssistant,DEFAULT_CONFIG}=require('./assistant.cjs');
const browser={id:'541b3fad-0000-4000-8000-000000000000',name:'Navigateur Opera GX',aliases:['Opéra','le navigateur'],description:'Navigateur',enabled:true,
  executable:'C:\\browser.exe',arguments:[],media:{sourceAppId:'opera.exe',deezer:false}};
const other={...browser,id:'11111111-1111-4111-8111-111111111111',name:'Deezer',aliases:['Diseur'],media:{sourceAppId:'Deezer.exe',deezer:false}};
async function fixture(t,options={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pam-alias-test-'));
  t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('pam-alias-test-'));await fs.rm(directory,{recursive:true,force:true});});
  const config={...DEFAULT_CONFIG,applications:[browser,other],autoExecute:false,...options.config};
  await fs.writeFile(path.join(directory,'applications.json'),JSON.stringify(config));
  const requests=[],executions=[];
  const handle=createAssistant({configDirectory:directory,runtimeDirectory:directory,
    media:{sessions:async()=>config.applications.filter(app=>app.media).map(app=>({sourceAppId:app.media.sourceAppId,capabilities:options.capabilities || {play:true,pause:true,next:true,previous:true,stop:true,toggle:true}})),
      execute:async(app,action)=>{executions.push({id:app.id,action});return{success:true};}},
    launchApplication:async(app,args)=>{executions.push({id:app.id,action:'open',args});return{success:true};},
    runEngine:async(_file,args)=>{
      if(!args.includes('--tools'))return{stdout:JSON.stringify({text:options.speechText,language:'fr'})};
      const tools=JSON.parse(await fs.readFile(args[args.indexOf('--tools')+1],'utf8'));
      requests.push({prompt:args[args.indexOf('--prompt')+1],tools});
      return{stdout:JSON.stringify(options.response || {confidence:0.7854,function_calls:[{name:tools[0].name,arguments:{}}]})};
    }});
  return{handle,directory,config,requests,executions};
}
const rule={phrase:'Pose le navigateur',applicationId:browser.id,action:'media_pause'};
test('correction explicite de pause : mémorisation, validation unique et retrait du mauvais plan',async t=>{
  const f=await fixture(t);
  const old=await f.handle('prepare_action',{applicationId:browser.id,action:'media_stop'});
  const corrected=await f.handle('correct_request',{id:old.id,text:'Pause le navigateur',applicationId:browser.id,action:'media_pause',saveCommandAlias:true,commandPhrase:rule.phrase});
  assert.equal(corrected.status,'pending');assert.equal(corrected.calls[0].action,'media_pause');assert.equal(corrected.confidence,null);assert.equal(corrected.correctedFrom,old.id);
  assert.equal(f.requests.length,0);assert.equal(f.executions.length,0);await assert.rejects(f.handle('confirm',{id:old.id}));
  await f.handle('confirm',{id:corrected.id});assert.deepEqual(f.executions,[{id:browser.id,action:'media_pause'}]);
  await assert.rejects(f.handle('confirm',{id:corrected.id}));
  const config=JSON.parse(await fs.readFile(path.join(f.directory,'applications.json'),'utf8'));
  assert.equal(config.commandAliases[0].phrase,rule.phrase);assert.deepEqual(config.applications[0].aliases,browser.aliases);
});
test('la formulation persistée cible la pause en texte comme en vocal et conserve la transcription',async t=>{
  const f=await fixture(t,{speechText:'POSE   LE NAVIGATEUR !'});
  const config=await f.handle('save_command_alias',rule),id=config.commandAliases[0].id;
  const reloaded=await f.handle('process_text',{text:'pose le navigateur.'});
  const {encodeWav}=await import('../src/audio/wav.ts');
  const voice=await f.handle('process_audio',{audio:Array.from(encodeWav(new Float32Array(16000)))});
  assert.equal(reloaded.commandAliasId,id);assert.equal(voice.commandAliasId,id);assert.equal(voice.transcript,'POSE   LE NAVIGATEUR !');
  assert.deepEqual(reloaded.calls,voice.calls);assert.equal(voice.calls[0].action,'media_pause');assert.equal(voice.confidence,0.7854);
  assert.equal(f.requests[0].prompt,'Pause audio in Opera GX');assert.deepEqual(f.requests[0],f.requests[1]);assert.equal(f.executions.length,0);
});
test('« mais le film en pose » peut être appris pour un lecteur choisi sans remplacement de mots global',async t=>{
  const f=await fixture(t);await f.handle('save_command_alias',{...rule,phrase:'Mais le film en pose'});
  const turn=await f.handle('process_text',{text:'Mais le film en pose.'});assert.equal(turn.calls[0].action,'media_pause');
  assert.equal(f.requests[0].prompt,'Pause audio in Opera GX');
  await f.handle('process_text',{text:'Ne mets pas le film en pose'});
  assert.equal(f.requests[1].prompt,'Ne mets pas le film en pose');assert.equal(f.executions.length,0);
});
test('modifier et supprimer une formulation invalide ses anciennes confirmations',async t=>{
  const f=await fixture(t),config=await f.handle('save_command_alias',rule),id=config.commandAliases[0].id;
  const pending=await f.handle('process_text',{text:rule.phrase});
  const updated=await f.handle('save_command_alias',{...rule,id,action:'media_play'});
  assert.equal(updated.commandAliases.length,1);assert.equal(updated.commandAliases[0].id,id);await assert.rejects(f.handle('confirm',{id:pending.id}),/applications ont changé/);
  const resumed=await f.handle('process_text',{text:rule.phrase});assert.equal(resumed.calls[0].action,'media_play');
  const deleted=await f.handle('delete_command_alias',{id});assert.equal(deleted.commandAliases.length,0);
  await assert.rejects(f.handle('confirm',{id:resumed.id}),/applications ont changé/);
  assert.equal(f.executions.length,0);
});
test('la création refuse doublons, négations, citations et collisions avec les commandes natives',async t=>{
  const f=await fixture(t);await f.handle('save_command_alias',rule);
  for(const phrase of ['POSE le navigateur !','Ne joue pas le navigateur','Joue pas le navigateur','Elle a dit « Pause le navigateur »','Play le navigateur'])
    await assert.rejects(f.handle('save_command_alias',{...rule,phrase}),undefined,phrase);
  await assert.rejects(f.handle('save_command_alias',{...rule,applicationId:other.id}));
  await assert.rejects(f.handle('save_command_alias',{...rule,phrase:'Pàuse   le navigateur',action:'media_stop'}),/autre action/);
  const config=JSON.parse(await fs.readFile(path.join(f.directory,'applications.json'),'utf8'));assert.equal(config.commandAliases.length,1);
});
test('les routes Deezer non vérifiées et les paramètres arbitraires ne sont pas mémorisables',async t=>{
  const f=await fixture(t);
  for(const action of ['deezer_queue_next','deezer_content','run_shell','media_seek'])await assert.rejects(f.handle('save_command_alias',{...rule,action}));
  await assert.rejects(f.handle('save_command_alias',{...rule,pattern:'.*'}));
  await assert.rejects(f.handle('save_command_alias',{...rule,phrase:'x'.repeat(201)}));
  await assert.rejects(f.handle('correct_request',{id:browser.id,text:'Pose',applicationId:browser.id,saveCommandAlias:true,commandPhrase:'Pose'}),/explicitement/);
});
test('apprendre une pause reste possible lorsque le lecteur est déjà en pause ; le routage attend sa capacité',async t=>{
  const f=await fixture(t,{capabilities:{play:true,pause:false}});
  const corrected=await f.handle('correct_request',{id:browser.id,text:rule.phrase,applicationId:browser.id,action:'media_pause',saveCommandAlias:true,commandPhrase:rule.phrase});
  assert.equal(corrected.status,'pending');
  const turn=await f.handle('process_text',{text:rule.phrase});assert.equal(turn.status,'unsupported');assert.equal(f.requests.length,0);assert.equal(f.executions.length,0);
});
test('une application désactivée ne fait pas retomber sa formulation sur un autre lecteur',async t=>{
  const f=await fixture(t);await f.handle('save_command_alias',rule);
  const config=JSON.parse(await fs.readFile(path.join(f.directory,'applications.json'),'utf8'));config.applications[0].enabled=false;
  await fs.writeFile(path.join(f.directory,'applications.json'),JSON.stringify(config));
  const turn=await f.handle('process_text',{text:rule.phrase});assert.equal(turn.status,'unsupported');assert.equal(f.requests.length,0);
  await f.handle('delete_application',{id:browser.id});const deleted=JSON.parse(await fs.readFile(path.join(f.directory,'applications.json'),'utf8'));assert.equal(deleted.commandAliases.length,0);
});
test('un échec de mémorisation ne consomme pas l’ancienne proposition',async t=>{
  const f=await fixture(t);await f.handle('save_command_alias',rule);
  const old=await f.handle('prepare_action',{applicationId:browser.id,action:'media_stop'});
  await assert.rejects(f.handle('correct_request',{id:old.id,text:'Pause',applicationId:browser.id,action:'media_pause',saveCommandAlias:true,commandPhrase:rule.phrase}),/déjà enregistrée/);
  await f.handle('confirm',{id:old.id});assert.equal(f.executions[0].action,'media_stop');
});
test('les anciens profils sans formulations sont lus sans modification du fichier',async t=>{
  const f=await fixture(t);const legacy={...f.config};delete legacy.commandAliases;
  const text=JSON.stringify(legacy);await fs.writeFile(path.join(f.directory,'applications.json'),text);
  assert.deepEqual((await f.handle('status')).config.commandAliases,[]);assert.equal(await fs.readFile(path.join(f.directory,'applications.json'),'utf8'),text);
});
test('un alias de lancement vers un éditeur conserve les valeurs à transmettre',async t=>{
  const editor={...browser,media:undefined,name:'Éditeur',aliases:['Editor'],arguments:['{input}']};
  const input='mais le film en pose',phrase='Mon éditeur avec le texte mais le film en pose';
  const f=await fixture(t,{config:{applications:[editor]},response:{confidence:0.9,function_calls:[{name:'open_editeur',arguments:{input}}]}});
  await f.handle('save_command_alias',{phrase,applicationId:editor.id,action:'open'});
  const turn=await f.handle('process_text',{text:phrase});assert.equal(f.requests[0].prompt,phrase);assert.equal(turn.calls[0].arguments.input,input);
});
