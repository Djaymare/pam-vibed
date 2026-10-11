const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createAssistant,DEFAULT_CONFIG,actionToolName}=require('./assistant.cjs');
const {DEEZER_APP_ID}=require('./deezer.cjs');
const {recognizeDeezerCommand}=require('./deezer-commands.cjs');
const app={id:'11111111-1111-4111-8111-111111111111',name:'Deezer Music',aliases:['Diseur','Deezer'],description:'Musique',enabled:true,
  executable:'C:\\fixture.exe',arguments:[],windowsApp:{appId:DEEZER_APP_ID,kind:'store'},media:{sourceAppId:'Deezer.exe',deezer:true}};
const browser={...app,id:'22222222-2222-4222-8222-222222222222',name:'Opera',aliases:['Navigateur'],windowsApp:undefined,media:{sourceAppId:'opera.exe',deezer:false}};
async function fixture(t,options={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pam-deezer-routing-'));
  t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('pam-deezer-routing-'));await fs.rm(directory,{recursive:true,force:true});});
  const config={...DEFAULT_CONFIG,applications:[app,browser],autoExecute:false,...options.config};
  await fs.writeFile(path.join(directory,'applications.json'),JSON.stringify(config));
  const requests=[],executions=[];
  const handle=createAssistant({configDirectory:directory,runtimeDirectory:directory,
    media:{sessions:async()=>config.applications.filter(app=>app.media).map(app=>({sourceAppId:app.media.sourceAppId,capabilities:{play:true,pause:true,next:true,previous:true,stop:true,toggle:true}})),
      execute:async(app,action,args)=>{executions.push({id:app.id,action,args});return {success:true};}},
    launchApplication:async(app,args)=>{executions.push({id:app.id,action:'open',args});return{success:true};},
    runEngine:async(_file,args)=>{
      if(!args.includes('--tools'))return{stdout:JSON.stringify({text:options.speechText,language:'fr'})};
      const tools=JSON.parse(await fs.readFile(args[args.indexOf('--tools')+1],'utf8'));
      requests.push({tools,prompt:args[args.indexOf('--prompt')+1],system:await fs.readFile(args[args.indexOf('--system')+1],'utf8')});
      return {stdout:JSON.stringify(options.response || {confidence:0.8357,function_calls:[{name:tools[0].name,arguments:{}}]})};
    }});
  return{handle,requests,executions,directory};
}
test('Flow, cœur/coeur et coûts de cœur ciblent la sélection choisie sans paramètre généré',async t=>{
  const f=await fixture(t);
  for(const [text,mix] of [['Démarrer Flow dans Diseur.','flow'],['Lire les coups de cœur dans Diseur','loved_tracks'],['Lire les coups de coeur dans Diseur','loved_tracks'],['Lire les coûts de cœur dans Diseur','loved_tracks']]) {
    const turn=await f.handle('process_text',{text});assert.equal(turn.transcript,text);assert.equal(turn.calls[0].applicationId,app.id);
    assert.equal(turn.calls[0].action,'deezer_start');assert.deepEqual(turn.calls[0].arguments,{mix});assert.equal(turn.confidence,0.8357);
    assert.equal(f.requests.at(-1).tools.length,1);assert.deepEqual(f.requests.at(-1).tools[0].parameters.properties,{});
    assert.equal(turn.calls[0].actionLabel,mix==='flow'?'Démarrer Flow':'Lire les coups de cœur');
  }
  assert.equal(f.executions.length,0);
});
test('la recherche conserve accents, ponctuation et casse ; aucun artiste n’est corrigé arbitrairement',async t=>{
  const f=await fixture(t);
  const query='Été / Dave Pink ?';
  const turn=await f.handle('process_text',{text:`Rechercher ${query} dans Diseur.`});
  assert.deepEqual(turn.calls[0].arguments,{query});assert.equal(turn.calls[0].actionLabel,`Rechercher « ${query} »`);
  assert.equal(f.requests[0].prompt,'Search Deezer Music');assert.equal(f.requests[0].tools[0].name,'search_deezer_music');
});
test('les huit pages ne sont plus laissées au choix du modèle',async t=>{
  const f=await fixture(t);
  const pages={accueil:'home',podcasts:'podcasts',Explorer:'explore',classements:'charts',ambiances:'moods',radios:'radios','réglages audio':'audio_settings',apparence:'theme'};
  for(const [text,page] of Object.entries(pages)) {
    const turn=await f.handle('process_text',{text:`Afficher la page ${text} dans Diseur`});
    assert.equal(turn.calls[0].action,'deezer_page');assert.deepEqual(turn.calls[0].arguments,{page});
  }
});
test('le nom interne Deezer reste stable quand l’utilisateur renomme sa fiche',async t=>{
  const f=await fixture(t,{config:{applications:[{...app,name:'Ma musique'}]}});
  const turn=await f.handle('process_text',{text:'Démarrer Flow dans Ma musique'});
  assert.equal(turn.calls[0].applicationName,'Ma musique');assert.equal(f.requests[0].prompt,'Start Flow in Deezer Music');
  assert.equal(f.requests[0].tools[0].name,'flow_deezer_music');
});
test('les identifiants de contenu longs et la casse des sélections sont préservés',async t=>{
  const f=await fixture(t);
  for(const [text,action,args] of [
    ['Afficher le podcast 1234567890123456789 dans Diseur','deezer_content',{kind:'show',id:'1234567890123456789'}],
    ['Affiche la sélection smarttracklist AbC_123-x dans Diseur','deezer_smarttracklist',{id:'AbC_123-x',mode:'display'}],
    ['Joue la sélection smarttracklist AbC_123-x dans Diseur','deezer_smarttracklist',{id:'AbC_123-x',mode:'play'}],
  ]) {const turn=await f.handle('process_text',{text});assert.equal(turn.calls[0].action,action);assert.deepEqual(turn.calls[0].arguments,args);}
});
test('Needle ne peut changer un paramètre fixé ou répéter une action reconnue',async t=>{
  for(const calls of [[{name:'search_deezer_music',arguments:{query:'Autre titre'}}],[{name:'search_deezer_music',arguments:{}},{name:'search_deezer_music',arguments:{}}]]) {
    const f=await fixture(t,{response:{confidence:1,function_calls:calls}});
    await assert.rejects(f.handle('process_text',{text:'Rechercher Dave Pink dans Diseur'}),/modifié les paramètres/);assert.equal(f.executions.length,0);
  }
});
test('un appel fiable à une autre action ou un autre lecteur est toujours refusé',async t=>{
  for(const call of [{name:actionToolName(app,'deezer_start'),arguments:{mix:'flow'}},{name:'open_opera',arguments:{}}]) {
    const f=await fixture(t,{response:{confidence:1,function_calls:[call]}});
    await assert.rejects(f.handle('process_text',{text:'Rechercher Dave Pink dans Diseur'}),/application différente/);assert.equal(f.executions.length,0);
  }
});
test('négations, citations, alias partagés et demandes composées ne sont pas des commandes fixes',()=>{
  for(const text of ['Ne démarre pas Flow dans Diseur','Elle a dit « Démarrer Flow dans Diseur »','Lire les coups de cœur dans Opera','Rechercher Dave Pink et démarrer Flow dans Diseur'])
    assert.equal(recognizeDeezerCommand(text,{applications:[app,browser]}),null,text);
  assert.equal(recognizeDeezerCommand('Démarrer Flow dans Diseur',{applications:[app,{...browser,aliases:['Diseur']}]}),null);
});
test('le vocal et le texte utilisent la même commande fixe avec le score brut',async t=>{
  const text='Lire les coûts de cœur dans Diseur';const f=await fixture(t,{speechText:text});
  const {encodeWav}=await import('../src/audio/wav.ts');
  const voice=await f.handle('process_audio',{audio:Array.from(encodeWav(new Float32Array(16000)))}),typed=await f.handle('process_text',{text});
  assert.deepEqual(voice.calls,typed.calls);assert.equal(voice.transcript,text);assert.equal(voice.confidence,0.8357);assert.deepEqual(f.requests[0],f.requests[1]);
});
test('les préférences d’exécution et les faibles scores continuent à s’appliquer',async t=>{
  const f=await fixture(t,{config:{autoExecute:true,confidenceThreshold:0.7}});
  const turn=await f.handle('process_text',{text:'Démarrer Flow dans Diseur'});assert.equal(turn.status,'executed');assert.equal(f.executions.length,1);
  const low=await fixture(t,{config:{autoExecute:true},response:{confidence:0.3,function_calls:[{name:'flow_deezer_music',arguments:{}}]}});
  assert.equal((await low.handle('process_text',{text:'Démarrer Flow dans Diseur'})).status,'pending');assert.equal(low.executions.length,0);
});
test('la correction explicite de recherche mémorise le texte choisi et exige une validation',async t=>{
  const f=await fixture(t);const phrase='Rechercher Dave Pink dans Diseur';
  const old=await f.handle('process_text',{text:phrase});
  const corrected=await f.handle('correct_request',{id:old.id,text:phrase,applicationId:app.id,action:'deezer_search',arguments:{query:'Daft Punk'},saveCommandAlias:true,commandPhrase:phrase});
  assert.equal(corrected.status,'pending');assert.equal(corrected.confidence,null);assert.deepEqual(corrected.calls[0].arguments,{query:'Daft Punk'});
  await assert.rejects(f.handle('confirm',{id:old.id}));
  const learned=await f.handle('process_text',{text:phrase});assert.ok(learned.commandAliasId);assert.equal(learned.transcript,phrase);assert.deepEqual(learned.calls[0].arguments,{query:'Daft Punk'});
  assert.equal(f.executions.length,0);
});
test('les formulations Deezer utilisent uniquement des routes, paramètres et cibles configurés',async t=>{
  const f=await fixture(t);
  for(const rule of [
    {action:'deezer_search',arguments:{query:'test',uri:'deezer://flushCache'}},
    {action:'deezer_page',arguments:{page:'flushCache'}},
    {action:'deezer_start',arguments:{mix:'flow'},applicationId:browser.id},
    {action:'deezer_start',arguments:{mix:'flow'},phrase:'Lire les coups de cœur dans Diseur'},
    {action:'deezer_start',arguments:{mix:'flow'},phrase:'Joue la chanson 3135556 dans Diseur'},
    {action:'deezer_queue_next',arguments:{id:'3135556'}},
    {action:'media_play',arguments:{query:'test'}},
  ])await assert.rejects(f.handle('save_command_alias',{phrase:'Ma formulation Deezer',applicationId:app.id,...rule}));
});
test('une formulation personnelle peut mémoriser une page et un identifiant explicitement choisi',async t=>{
  const f=await fixture(t);
  for(const [phrase,action,args] of [['Mon accueil musical','deezer_page',{page:'home'}],['Mon album favori','deezer_content',{kind:'album',id:'3135556'}]]) {
    await f.handle('save_command_alias',{phrase,applicationId:app.id,action,arguments:args});
    const turn=await f.handle('process_text',{text:phrase});assert.equal(turn.calls[0].action,action);assert.deepEqual(turn.calls[0].arguments,args);
  }
});
