const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createAssistant, DEFAULT_CONFIG, toolName} = require('./assistant.cjs');

const app = {id:'11111111-1111-4111-8111-111111111111',name:'Test',aliases:[],
  description:'Application de test',executable:'C:\\fixture.exe',arguments:[],enabled:true};
const other = {...app,id:'22222222-2222-4222-8222-222222222222',name:'Autre'};
const open = application => ({name:toolName(application),arguments:{}});
async function fixture(t, response, config = {}, speechText) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'pam-cardinality-'));
  t.after(async()=>{
    assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('pam-cardinality-'));
    await fs.rm(directory,{recursive:true,force:true});
  });
  await fs.writeFile(path.join(directory,'applications.json'),JSON.stringify({...DEFAULT_CONFIG,autoExecute:true,applications:[app],...config}));
  const launches=[];
  const handle=createAssistant({configDirectory:directory,runtimeDirectory:directory,
    runEngine:async(_file,args)=>({stdout:JSON.stringify(args.includes('--tools')?response:{text:speechText,language:'fr'})}),
    launchApplication:async(application,args)=>{launches.push({id:application.id,args});return {success:true,message:'Lancé'};}});
  return {handle,launches};
}
test('PAM-08 : Ouvre Test refuse les deux appels à 99 % avant tout lancement',async t=>{
  const f=await fixture(t,{confidence:0.99,function_calls:[open(app),open(app)]});
  await assert.rejects(f.handle('process_text',{text:'Ouvre Test'}),/plusieurs appels|supplémentaire/);
  assert.equal(f.launches.length,0);
});
test('PAM-08 : un seul appel simple conserve le résultat et un seul lancement',async t=>{
  const f=await fixture(t,{confidence:0.99,function_calls:[open(app)]});
  const turn=await f.handle('process_text',{text:'Ouvre Test'});
  assert.equal(turn.status,'executed');assert.equal(turn.results.length,1);
  assert.equal(turn.results[0].success,true);assert.equal(f.launches.length,1);
});
test('PAM-08 : les doublons vocaux et les appels supprimés sont aussi refusés',async t=>{
  for(const suppressed of [false,true]){
    const f=await fixture(t,{confidence:0.99,function_calls:suppressed?[]:[open(app),open(app)],
      ...(suppressed?{suppressed_calls:[open(app),open(app)]}:{})},{},'Ouvre Test');
    const {encodeWav}=await import('../src/audio/wav.ts');
    await assert.rejects(f.handle('process_audio',{audio:Array.from(encodeWav(new Float32Array(16000)))}),/plusieurs appels|supplémentaire/);
    assert.equal(f.launches.length,0);
  }
});
test('PAM-08 : une commande libre simple refuse aussi un second appel inventé',async t=>{
  const f=await fixture(t,{confidence:0.99,function_calls:[open(app),open(app)]});
  await assert.rejects(f.handle('process_text',{text:'Merci de lancer Test'}),/plusieurs appels|supplémentaire/);
  assert.equal(f.launches.length,0);
});
test('PAM-08 : deux applications demandées gardent leurs deux lancements',async t=>{
  for(const text of ['Ouvre Test et Autre','Ouvre Test puis ouvre Autre','Open Test and Autre']){
    const f=await fixture(t,{confidence:0.99,function_calls:[open(app),open(other)]},{applications:[app,other]});
    const pending=await f.handle('process_text',{text});
    assert.equal(pending.status,'pending');assert.equal(f.launches.length,0);
    const turn=await f.handle('confirm',{id:pending.id});
    assert.equal(turn.status,'executed');assert.equal(turn.results.length,2);
    assert.deepEqual(f.launches.map(launch=>launch.id),[app.id,other.id]);
  }
});
test('PAM-08 : un troisième lancement inventé invalide tout le plan composé',async t=>{
  const f=await fixture(t,{confidence:0.99,function_calls:[open(app),open(other),open(app)]},{applications:[app,other]});
  await assert.rejects(f.handle('process_text',{text:'Ouvre Test et Autre'}),/supplémentaire/);
  assert.equal(f.launches.length,0);
});
test('PAM-08 : répétitions explicites préservées même avec une seule application configurée',async t=>{
  for(const text of ['Ouvre Test deux fois','Ouvre deux fois Test','OPEN TEST TWICE','Open Test 2 times','Ouvre Test puis ouvre Test']){
    const f=await fixture(t,{confidence:0.99,function_calls:[open(app),open(app)]});
    const pending=await f.handle('process_text',{text});
    assert.equal(pending.status,'pending',text);assert.equal(f.launches.length,0,text);
    const turn=await f.handle('confirm',{id:pending.id});
    assert.equal(turn.status,'executed',text);assert.equal(turn.results.length,2,text);
    assert.equal(f.launches.length,2,text);
  }
});
test('PAM-08 : une répétition ne permet pas de répéter une autre application du plan',async t=>{
  const f=await fixture(t,{confidence:0.99,function_calls:[open(app),open(other),open(other)]},{applications:[app,other]});
  await assert.rejects(f.handle('process_text',{text:'Ouvre Test deux fois et Autre'}),/supplémentaire/);
  assert.equal(f.launches.length,0);
  const valid=await fixture(t,{confidence:0.99,function_calls:[open(app),open(app),open(other)]},{applications:[app,other]});
  const pending=await valid.handle('process_text',{text:'Ouvre Test deux fois et Autre'});
  assert.equal(pending.status,'pending');assert.equal(valid.launches.length,0);
  const turn=await valid.handle('confirm',{id:pending.id});
  assert.equal(turn.status,'executed');assert.equal(valid.launches.length,3);
});
test('PAM-08 : le modèle ne peut pas réduire silencieusement une répétition explicite',async t=>{
  const f=await fixture(t,{confidence:0.99,function_calls:[open(app)]});
  await assert.rejects(f.handle('process_text',{text:'Ouvre Test deux fois'}),/nombre d’ouvertures/);
  assert.equal(f.launches.length,0);
});
test('PAM-08 : dépasser une répétition explicite refuse tous les appels',async t=>{
  const f=await fixture(t,{confidence:0.99,function_calls:[open(app),open(app),open(app)]});
  await assert.rejects(f.handle('process_text',{text:'Ouvre Test deux fois'}),/supplémentaire/);
  assert.equal(f.launches.length,0);
});
test('PAM-08 : répétition dans du texte transmis ou cité ne donne pas de lancement en plus',async t=>{
  for(const text of ['Ouvre Test avec le texte « deux fois »','Ouvre Test avec le texte Test puis Test','Ouvre Test "twice"']){
    const inputApp={...app,arguments:['{input}']};
    const f=await fixture(t,{confidence:0.99,function_calls:[open(inputApp),open(inputApp)]},{applications:[inputApp]});
    await assert.rejects(f.handle('process_text',{text}),/plusieurs appels|supplémentaire/);
    assert.equal(f.launches.length,0);
  }
});
test('PAM-08 : faible confiance ou ambiguïté du moteur conserve la confirmation',async t=>{
  for(const response of [{confidence:0.2,function_calls:[open(app)]},
    {confidence:0.99,function_calls:[open(app)],validation:{ungrounded:['target']}},
    {confidence:0.99,function_calls:[],suppressed_calls:[open(app)]}]){
    const f=await fixture(t,response);const turn=await f.handle('process_text',{text:'Ouvre Test'});
    assert.equal(turn.status,'pending');assert.equal(f.launches.length,0);
    const confirmed=await f.handle('confirm',{id:turn.id});
    assert.equal(confirmed.status,'executed');assert.equal(f.launches.length,1);
    assert.equal((await f.handle('confirm',{id:turn.id})).status, 'consumed');assert.equal(f.launches.length,1);
  }
});
test('PAM-08 : répétition valide à faible confiance attend la confirmation du plan entier',async t=>{
  const f=await fixture(t,{confidence:0.2,function_calls:[open(app),open(app)]});
  const turn=await f.handle('process_text',{text:'Ouvre Test deux fois'});
  assert.equal(turn.status,'pending');assert.equal(f.launches.length,0);
  assert.equal((await f.handle('confirm',{id:turn.id})).status,'executed');assert.equal(f.launches.length,2);
});
