const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createMedia,resolveSession} = require('./media.cjs');
const {DEEZER_APP_ID,deezerUri} = require('./deezer.cjs');
const {toolsFor,validateCalls,actionToolName,createAssistant,DEFAULT_CONFIG} = require('./assistant.cjs');
const deezer = {id:'11111111-1111-4111-8111-111111111111',name:'Deezer',description:'Musique',executable:'C:\\Windows\\explorer.exe',
  arguments:[`shell:AppsFolder\\${DEEZER_APP_ID}`],aliases:['Diseur'],enabled:true,
  windowsApp:{appId:DEEZER_APP_ID,kind:'store',icon:null},media:{sourceAppId:'Deezer.exe',deezer:true}};
const browser = {...deezer,id:'22222222-2222-4222-8222-222222222222',name:'Navigateur',aliases:[],windowsApp:undefined,media:{sourceAppId:'opera.exe',deezer:false}};
const session = {sourceAppId:'Deezer.exe',title:'Fixture',capabilities:{play:true,pause:false,next:true,previous:false,stop:false,toggle:true}};
const config = {...DEFAULT_CONFIG,applications:[deezer,browser]};
function call(action,args={}) { return {name:actionToolName(deezer,action),arguments:args}; }

test('le lecteur est résolu par identité exacte, jamais par nom partiel ou session courante',()=>{
  assert.equal(resolveSession([{...session,sourceAppId:'opera.exe'},session],'DEEzer.EXE'),session);
  assert.throws(()=>resolveSession([session],'deezer'),/Aucune session/);
  assert.throws(()=>resolveSession([session,session],'Deezer.exe'),/Plusieurs sessions/);
  assert.throws(()=>resolveSession([{sourceAppId:'Deezer.exe',error:'closed'}],'Deezer.exe'),/fermée/);
});
test('seules les capacités réelles et non ambiguës sont proposées à Needle',()=>{
  const names=toolsFor(config,[session,{...session,sourceAppId:'opera.exe',capabilities:{pause:true}}]).map(t=>t.name);
  assert.ok(names.includes(actionToolName(deezer,'media_play')));
  assert.ok(names.includes(actionToolName(deezer,'media_next')));
  assert.ok(!names.includes(actionToolName(deezer,'media_pause')));
  assert.ok(names.includes(actionToolName(browser,'media_pause')));
  assert.ok(!names.includes(actionToolName(browser,'media_next')));
  assert.ok(!toolsFor(config,[session,session]).some(t=>t.name===actionToolName(deezer,'media_play')));
  assert.ok(toolsFor(config,[]).some(t=>t.name===actionToolName(deezer,'deezer_search')));
});
test('arguments, identifiants et types Deezer stricts ; aucun URI arbitraire ni contrôle de file',()=>{
  assert.equal(validateCalls([call('media_next')],config)[0].action,'media_next');
  assert.throws(()=>validateCalls([call('media_next',{id:'3135556'})],config),/aucun argument/);
  assert.throws(()=>validateCalls([call('deezer_content',{kind:'track',id:'1?autoplay=true'})],config),/Identifiant/);
  assert.throws(()=>validateCalls([call('deezer_content',{kind:'autolog',id:'1'})],config),/Type/);
  assert.throws(()=>validateCalls([call('deezer_content',{kind:'track',id:'1',autoplay:'true'})],config),/non autorisé/);
  assert.throws(()=>validateCalls([call('deezer_queue_next',{id:'1'})],config),/inconnu/);
  assert.throws(()=>validateCalls([call('deezer_search',{query:'ok\0token'})],config),/invalide/);
  assert.throws(()=>validateCalls([call('deezer_page',{page:'flushCache'})],config),/non autorisée/);
});
test('routes établies : contenu, recherche encodée, pages, Flow et coups de cœur',()=>{
  for(const kind of ['track','album','artist','playlist','show','episode','profile'])
    assert.equal(deezerUri('deezer_content',{kind,id:'3135556'}),`deezer://www.deezer.com/${kind}/3135556`);
  assert.equal(deezerUri('deezer_search',{query:'été / Daft Punk?'}),'deezer://www.deezer.com/search/%C3%A9t%C3%A9%20%2F%20Daft%20Punk%3F');
  assert.equal(deezerUri('deezer_start',{mix:'flow'}),'deezer://www.deezer.com/user/me/flow');
  assert.equal(deezerUri('deezer_start',{mix:'loved_tracks'}),'deezer://www.deezer.com/user/me/tracks');
  assert.equal(deezerUri('deezer_page',{page:'home'}),'deezer://www.deezer.com/');
  assert.equal(deezerUri('deezer_page',{page:'charts'}),'deezer://www.deezer.com/channels/charts');
  assert.equal(deezerUri('deezer_page',{page:'audio_settings'}),'deezer://www.deezer.com/settings/audio');
  assert.equal(deezerUri('deezer_reload',{}),'deezer://www.deezer.com/reload');
  assert.equal(deezerUri('deezer_smarttracklist',{id:'fixture-id',mode:'play'}),'deezer://www.deezer.com/smarttracklist/fixture-id?autoplay=true');
});
test('refus, résultat manquant et capacité non prise en charge ne deviennent jamais une réussite',async()=>{
  for(const response of [{accepted:false},{},null]) {
    const media=createMedia(async r=>r.method==='media_sessions'?[session]:response);
    await assert.rejects(media.execute(deezer,'media_play',{}));
  }
  const requests=[];
  const media=createMedia(async r=>{requests.push(r);return r.method==='media_sessions'?[session]:{accepted:true};});
  await assert.rejects(media.execute(deezer,'media_pause',{}),/ne prend.*pas en charge/);
  assert.equal(requests.filter(r=>r.method==='media_action').length,0);
  await media.execute(deezer,'media_play',{});
  assert.deepEqual(requests.at(-1),{method:'media_action',sourceAppId:'Deezer.exe',action:'play'});
});
test('un lien Deezer cible le paquet exact et annonce seulement son envoi',async()=>{
  const requests=[];
  const media=createMedia(async r=>{requests.push(r);return {accepted:true};});
  const result=await media.execute(deezer,'deezer_content',{kind:'track',id:'3135556'});
  assert.match(result.message,/Lien envoyé/);assert.match(result.message,/lecture.*ne sont pas modifiées/);
  assert.deepEqual(requests,[{method:'deezer_open',uri:'deezer://www.deezer.com/track/3135556'}]);
  await assert.rejects(media.execute(browser,'deezer_content',{kind:'track',id:'3135556'}),/plugin nécessite/);
  await assert.rejects(createMedia(async()=>({accepted:false})).execute(deezer,'deezer_search',{query:'test'}),/Windows a refusé/);
});

async function fixture(t,engineResponse,speechText) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pam-media-test-'));
  t.after(async()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('pam-media-test-'));await fs.rm(directory,{recursive:true,force:true});});
  await fs.writeFile(path.join(directory,'applications.json'),JSON.stringify({...config,autoExecute:false}));
  const calls=[],prompts=[];
  const media={sessions:async()=>[session],execute:async(...args)=>{calls.push(args);return {success:true,message:'acceptée'};}};
  const handle=createAssistant({configDirectory:directory,runtimeDirectory:directory,media,
    launchApplication:async()=>{throw new Error('Le lancement ne doit pas remplacer une commande média.');},
    runEngine:async(_file,args)=>{
      if(args.includes('--audio') && !args.includes('--tools'))return {stdout:JSON.stringify({text:speechText,language:'fr'})};
      const tools=JSON.parse(await fs.readFile(args[args.indexOf('--tools')+1],'utf8'));
      prompts.push({prompt:args[args.indexOf('--prompt')+1],tools});
      return {stdout:JSON.stringify({...engineResponse || {confidence:0.9,function_calls:[call('media_play')]},
        ...(args.includes('--audio') ? {audio_text:speechText,audio_language:'fr'} : {})})};
    }});
  return {handle,calls,prompts,directory};
}
test('clic manuel : validation obligatoire, consommation unique et pas de lancement substitué',async t=>{
  const f=await fixture(t);
  const turn=await f.handle('prepare_action',{applicationId:deezer.id,action:'media_next',arguments:{}});
  assert.equal(turn.status,'pending');assert.equal(f.calls.length,0);
  await f.handle('confirm',{id:turn.id});assert.equal(f.calls[0][1],'media_next');
  assert.equal((await f.handle('confirm',{id:turn.id})).status, 'consumed');assert.equal(f.calls.length,1);
});
test('le changement de cible média invalide une confirmation',async t=>{
  const f=await fixture(t);const turn=await f.handle('prepare_action',{applicationId:deezer.id,action:'media_next'});
  const c=JSON.parse(await fs.readFile(path.join(f.directory,'applications.json'),'utf8'));c.applications[0].media.sourceAppId='opera.exe';c.applications[0].media.deezer=false;
  await fs.writeFile(path.join(f.directory,'applications.json'),JSON.stringify(c));
  assert.equal((await f.handle('confirm',{id:turn.id})).status, 'invalidated');assert.equal(f.calls.length,0);
});
test('alias média : outil de la bonne action seulement, métadonnées internes exclues du modèle',async t=>{
  const f=await fixture(t);const turn=await f.handle('process_text',{text:'Joue Diseur'});
  assert.equal(turn.calls[0].action,'media_play');assert.deepEqual(f.prompts[0].tools.map(t=>t.name),['play_deezer_music']);
  assert.equal(f.prompts[0].tools[0].applicationId,undefined);
});
test('la correction conserve l’action média et les confirmations existantes',async t=>{
  const f=await fixture(t,{confidence:0.9,function_calls:[call('media_next')]});
  const old=await f.handle('prepare_action',{applicationId:deezer.id,action:'media_play'});
  const corrected=await f.handle('correct_request',{id:old.id,text:'Piste suivante Diseur',applicationId:deezer.id});
  assert.equal(corrected.status,'pending');assert.equal(corrected.calls[0].action,'media_next');
  assert.equal(corrected.transcript,'Piste suivante Diseur');assert.equal(f.prompts[0].prompt,'Play the next item in Deezer Music');assert.equal((await f.handle('confirm',{id:old.id})).status, 'invalidated');
});
test('une insertion précise en prochaine position ne devient pas un simple saut de piste',async t=>{
  const f=await fixture(t,{confidence:1,function_calls:[call('media_next')]});
  const turn=await f.handle('process_text',{text:'Ajoute la chanson 3135556 dans la file en prochaine position sur Diseur'});
  assert.equal(turn.status,'unsupported');assert.equal(turn.calls.length,0);assert.match(turn.message,/insérer/);assert.equal(f.prompts.length,0);
});
test('un identifiant de chanson inventé est refusé avant confirmation ou exécution',async t=>{
  const f=await fixture(t,{confidence:1,function_calls:[call('deezer_content',{kind:'track',id:'3135556'})]});
  await assert.rejects(f.handle('process_text',{text:'Affiche une chanson de Daft Punk dans Deezer'}),/ne figure pas/);assert.equal(f.calls.length,0);
});

test('une demande de lecture précise ne devient pas une reprise de la session',async t=>{
  const f=await fixture(t,{confidence:1,function_calls:[call('media_play')]});
  for (const text of ['Joue la chanson 3135556 dans Diseur','Lance le titre One More Time sur Deezer']) {
    const turn=await f.handle('process_text',{text});
    assert.equal(turn.status,'unsupported');assert.equal(turn.calls.length,0);assert.match(turn.message,/lecture précise/);
  }
  assert.equal(f.prompts.length,0);assert.equal(f.calls.length,0);
});

test('un titre sans mot « chanson » ne devient pas une reprise ou un Flow',async t=>{
  const f=await fixture(t,{confidence:1,function_calls:[call('media_play')]});
  const turn=await f.handle('process_text',{text:'Joue One More Time dans Deezer'});
  assert.equal(turn.status,'unsupported');assert.equal(turn.calls.length,0);assert.equal(f.calls.length,0);
});

test('un outil répété ne double pas une action explicite de piste suivante',async t=>{
  const f=await fixture(t,{confidence:1,function_calls:[call('media_next'),call('media_next')]});
  await assert.rejects(f.handle('process_text',{text:'Piste suivante Diseur'}),/plusieurs appels/);assert.equal(f.calls.length,0);
});

test('texte et vocal partagent le ciblage média par alias et le score réel',async t=>{
  const text='Piste suivante Diseur';
  const f=await fixture(t,{confidence:0.42,function_calls:[call('media_next')]},text);
  const {encodeWav}=await import('../src/audio/wav.ts');
  const voice=await f.handle('process_audio',{audio:Array.from(encodeWav(new Float32Array(16000)))});
  const typed=await f.handle('process_text',{text});
  assert.equal(voice.transcript,text);assert.deepEqual(voice.calls,typed.calls);assert.equal(voice.confidence,0.42);
  assert.equal(voice.confidence,typed.confidence);assert.equal(voice.status,'pending');assert.equal(f.calls.length,0);
});

test('le plugin enregistré refuse une session tierce ou un URI arbitraire', {skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);
  const draft={...deezer,id:undefined,executable:path.join(process.env.SystemRoot,'explorer.exe')};
  await assert.rejects(f.handle('save_application',{...draft,media:{sourceAppId:'opera.exe',deezer:true}}),/doit cibler/);
  await assert.rejects(f.handle('save_application',{...draft,media:{sourceAppId:'Deezer.exe',deezer:true,uri:'deezer://arbitrary'}}),/multimédia invalide/);
  assert.equal(f.calls.length,0);
});
