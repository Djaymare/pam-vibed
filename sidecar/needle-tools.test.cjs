const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createAssistant, toolsFor, actionToolName, DEFAULT_CONFIG} = require('./assistant.cjs');
const {needleTools, needleToolName} = require('./needle-tools.cjs');

const browser = {id:'541b3fad-0000-4000-8000-000000000000',name:'Navigateur Opera GX',aliases:['Opéra','le navigateur'],
  description:'Navigateur Internet',enabled:true,executable:'C:\\browser.exe',arguments:[],media:{sourceAppId:'opera.exe',deezer:false}};
const deezer = {...browser,id:'11111111-1111-4111-8111-111111111111',name:'Deezer',aliases:['Diseur'],media:{sourceAppId:'Deezer.exe',deezer:false}};
const ea = {...browser,id:'22222222-2222-4222-8222-222222222222',name:'EA',aliases:[],media:undefined};
const config = {...DEFAULT_CONFIG,applications:[browser,deezer,ea],confidenceThreshold:0.65};
async function fixture(t, response, options={}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'pam-needle-test-'));
  t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('pam-needle-test-'));await fs.rm(directory,{recursive:true,force:true});});
  const c = {...config,...options.config};
  await fs.writeFile(path.join(directory,'applications.json'),JSON.stringify(c));
  const requests=[],executions=[];
  const handle = createAssistant({configDirectory:directory,runtimeDirectory:directory,
    media:{sessions:async()=>c.applications.filter(app=>app.media).map(app=>({sourceAppId:app.media.sourceAppId,
      capabilities:options.capabilities ?? {play:true,pause:true,next:true,previous:true,stop:true,toggle:true}})),
      execute:async(app,action,args)=>{executions.push({applicationId:app.id,action,args});return {success:true};}},
    launchApplication:async(app,args)=>{executions.push({applicationId:app.id,action:'open',args});return {success:true};},
    runEngine:async(_file,args)=>{
      if(!args.includes('--tools'))return {stdout:JSON.stringify({text:options.speechText,language:'fr'})};
      requests.push({prompt:args[args.indexOf('--prompt')+1],tools:JSON.parse(await fs.readFile(args[args.indexOf('--tools')+1],'utf8'))});
      return {stdout:JSON.stringify(response)};
    }});
  return {handle,requests,executions,directory};
}

test('les noms publics courts sont résolus vers les actions persistées, sans altérer le score',async t=>{
  const f=await fixture(t,{confidence:0.7202,function_calls:[{name:'play_opera_gx',arguments:{}}]});
  const text='Play sur le navigateur';
  const turn=await f.handle('process_text',{text});
  assert.equal(turn.transcript,text);assert.equal(turn.confidence,0.7202);assert.equal(turn.status,'executed');
  assert.equal(turn.calls[0].name,actionToolName(browser,'media_play'));assert.equal(turn.calls[0].actionLabel,'Reprendre la lecture');
  assert.deepEqual(f.executions,[{applicationId:browser.id,action:'media_play',args:{}}]);
  assert.equal(f.requests[0].prompt,'Play audio in Opera GX');
  assert.deepEqual(Object.keys(f.requests[0].tools[0]).sort(),['description','name','parameters','triggers']);
  assert.equal(f.requests[0].tools[0].name,'play_opera_gx');
  assert.match(f.requests[0].tools[0].description,/Play or resume/);
});

test('un score faible garde le seuil et impose une confirmation avec le même identifiant interne',async t=>{
  const f=await fixture(t,{confidence:0.2346,function_calls:[{name:'play_opera_gx',arguments:{}}]});
  const turn=await f.handle('process_text',{text:'Play Opéra'});
  assert.equal(turn.confidence,0.2346);assert.equal(turn.status,'pending');assert.equal(f.executions.length,0);
  const saved=JSON.parse(await fs.readFile(path.join(f.directory,'proposals',`${turn.id}.json`),'utf8'));
  assert.equal(saved.turn.calls[0].name,actionToolName(browser,'media_play'));
  await f.handle('confirm',{id:turn.id});assert.equal(f.executions.length,1);
});

test('les collisions de noms publics restent uniques, stables et indépendantes de la sélection des outils',()=>{
  const twin={...browser,id:'541b3fad-0000-4000-8000-000000000001',name:'Opera GX',aliases:[]};
  const c={...config,applications:[browser,twin]};
  const tools=toolsFor(c),publicTools=needleTools(tools,c);
  assert.equal(new Set(publicTools.map(tool=>tool.name)).size,publicTools.length);
  const play=tools.find(tool=>tool.applicationId===browser.id&&tool.action==='media_play');
  assert.equal(needleTools([play],c)[0].name,needleToolName(play,c));
  assert.equal(needleToolName(play,{...c,applications:[twin,browser]}),needleToolName(play,c));
});

test('une proposition fiable sur une négation ou une commande rapportée est rejetée avant confirmation',async t=>{
  for(const text of ['Ne joue pas sur le navigateur','Joue pas sur le navigateur','N’ouvre pas EA',
    'Do not play le navigateur',"Don't play le navigateur",'Elle a dit : « Play sur le navigateur ».','« Play sur le navigateur »']) {
    const f=await fixture(t,{confidence:0.99,function_calls:[{name:'play_opera_gx',arguments:{}}]});
    const turn=await f.handle('process_text',{text});
    assert.equal(turn.status,'unsupported',text);assert.deepEqual(turn.calls,[],text);assert.equal(f.executions.length,0,text);
    assert.equal(turn.confidence,0.99,text);
    assert.deepEqual((await fs.readdir(f.directory)).filter(name=>name==='pending'),[],text);
  }
});

test('une application nommée empêche un appel fiable à un autre lecteur, même sans trigger exact',async t=>{
  const f=await fixture(t,{confidence:0.99,function_calls:[{name:'play_deezer',arguments:{}}]});
  const turn=await f.handle('process_text',{text:'Joue de la musique dans le navigateur'});
  assert.equal(turn.status,'unsupported');assert.equal(turn.calls.length,0);assert.match(turn.message,/application proposée/i);assert.equal(f.executions.length,0);
});

test('un lecteur inconnu ou sans contrôle média ne devient pas un lancement de EA',async t=>{
  for(const text of ['Play sur Firefox','Pause EA']) {
    const f=await fixture(t,{confidence:0.99,function_calls:[{name:'open_ea',arguments:{}}]});
    const turn=await f.handle('process_text',{text});
    assert.equal(turn.status,'unsupported',text);assert.equal(turn.calls.length,0);assert.equal(f.executions.length,0);
  }
});

test('une capacité média absente ne retombe pas sur un autre outil',async t=>{
  const f=await fixture(t,{confidence:1,function_calls:[{name:'open_ea',arguments:{}}]},{capabilities:{play:true,pause:false}});
  const turn=await f.handle('process_text',{text:'Pause le navigateur'});
  assert.equal(turn.status,'unsupported');assert.equal(turn.calls.length,0);assert.equal(f.requests.length,0);assert.equal(f.executions.length,0);
});

test('un alias média partagé ne peut pas choisir un lecteur arbitraire',async t=>{
  const shared={...deezer,aliases:['le navigateur']};
  const f=await fixture(t,{confidence:1,function_calls:[{name:'play_opera_gx',arguments:{}}]},{config:{applications:[browser,shared]}});
  const turn=await f.handle('process_text',{text:'Play le navigateur'});
  assert.equal(turn.status,'unsupported');assert.match(turn.message,/plusieurs applications/);assert.equal(f.executions.length,0);
});

test('les négations dans une entrée explicitement transmise ne bloquent pas le lancement de l’éditeur',async t=>{
  const editor={...ea,name:'Éditeur',aliases:['Editor'],arguments:['{input}']};
  const input='Ne joue pas sur le navigateur';
  const f=await fixture(t,{confidence:0.9,function_calls:[{name:'open_editeur',arguments:{input}}]},{config:{applications:[browser,editor]}});
  const text=`Ouvre Editor avec le texte « ${input} »`;
  const turn=await f.handle('process_text',{text});
  assert.equal(turn.status,'executed');assert.equal(f.requests[0].prompt,text);
  assert.deepEqual(f.executions,[{applicationId:editor.id,action:'open',args:{input}}]);
});

test('un argument input ne peut pas transformer une négation initiale en ordre positif',async t=>{
  const editor={...ea,name:'Éditeur',aliases:['Editor'],arguments:['{input}']};
  const text='Ne lance pas Editor';
  const f=await fixture(t,{confidence:1,function_calls:[{name:'open_editeur',arguments:{input:text}}]},{config:{applications:[editor]}});
  const turn=await f.handle('process_text',{text});
  assert.equal(turn.status,'unsupported');assert.equal(turn.calls.length,0);assert.equal(f.executions.length,0);
});

test('texte et vocal produisent le même ordre interne anglais avec la transcription française conservée',async t=>{
  const text='Pause le navigateur';
  const f=await fixture(t,{confidence:0.7854,function_calls:[{name:'pause_opera_gx',arguments:{}}]},{speechText:text,config:{autoExecute:false}});
  const {encodeWav}=await import('../src/audio/wav.ts');
  const voice=await f.handle('process_audio',{audio:Array.from(encodeWav(new Float32Array(16000)))});
  const typed=await f.handle('process_text',{text});
  assert.equal(voice.transcript,text);assert.equal(voice.language,'fr');assert.equal(voice.confidence,typed.confidence);
  assert.deepEqual(voice.calls,typed.calls);assert.equal(f.requests[0].prompt,'Pause audio in Opera GX');assert.deepEqual(f.requests[0],f.requests[1]);
});

test('les demandes composées et négatives ne sont pas reformulées en ordres positifs',async t=>{
  for(const text of ['Play le navigateur et ouvre EA','Ne joue pas sur le navigateur','Ouvre EA avec le texte Opera GX']) {
    const f=await fixture(t,{confidence:0.9,function_calls:[]});await f.handle('process_text',{text});
    assert.equal(f.requests[0].prompt,text);assert.ok(f.requests[0].tools.length>1);assert.equal(f.executions.length,0);
  }
});

test('une négation dans une demande composée bloque tout le plan avant son premier lancement',async t=>{
  for(const text of ['Ouvre EA et ne joue pas sur le navigateur','Play le navigateur but do not open EA']) {
    const f=await fixture(t,{confidence:1,function_calls:[{name:'open_ea',arguments:{}},{name:'play_opera_gx',arguments:{}}]});
    const turn=await f.handle('process_text',{text});
    assert.equal(turn.status,'unsupported');assert.equal(turn.calls.length,0);assert.equal(f.executions.length,0);
  }
});

test('une demande composée positive conserve ses deux actions explicites',async t=>{
  const text='Play le navigateur et ouvre EA';
  const f=await fixture(t,{confidence:0.9,function_calls:[{name:'play_opera_gx',arguments:{}},{name:'open_ea',arguments:{}}]});
  const turn=await f.handle('process_text',{text});
  assert.equal(turn.status,'executed');assert.equal(f.executions.length,2);assert.equal(f.requests[0].prompt,text);
});

test('une correction explicite du lecteur conserve l’action et impose une validation',async t=>{
  const f=await fixture(t,{confidence:0.99,function_calls:[{name:'pause_opera_gx',arguments:{}}]});
  const turn=await f.handle('correct_request',{id:browser.id,text:'Pause Diseur',applicationId:browser.id});
  assert.equal(turn.status,'pending');assert.equal(turn.transcript,'Pause Diseur');assert.equal(turn.calls[0].applicationId,browser.id);
  assert.equal(turn.calls[0].action,'media_pause');assert.equal(f.requests[0].prompt,'Pause audio in Opera GX');
  assert.equal(f.requests[0].tools.length,1);assert.equal(f.executions.length,0);
});

test('le choix manuel d’un lecteur résout un alias partagé sans exécuter automatiquement',async t=>{
  const shared={...deezer,aliases:['le navigateur']};
  const f=await fixture(t,{confidence:0.99,function_calls:[{name:'pause_opera_gx',arguments:{}}]},{config:{applications:[browser,shared]}});
  const turn=await f.handle('correct_request',{id:browser.id,text:'Pause le navigateur',applicationId:browser.id});
  assert.equal(turn.status,'pending');assert.equal(turn.calls[0].applicationId,browser.id);assert.equal(f.executions.length,0);
});
