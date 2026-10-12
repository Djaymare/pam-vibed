const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAssistant, DEFAULT_CONFIG, toolName } = require('./assistant.cjs');
const {createBudget}=require('./budget.cjs');
const {createMedia}=require('./media.cjs');
const {createHostChannel}=require('./host.cjs');

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-budget-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    await fs.rm(directory, { recursive: true, force: true });
  });
  const app = { id:'11111111-1111-4111-8111-111111111111', name:'Fixture', aliases:[], description:'Fixture', executable:'C:\\fixture.exe', arguments:[], enabled:true };
  await fs.writeFile(path.join(directory,'applications.json'), JSON.stringify({...DEFAULT_CONFIG, applications:[app], ...overrides}));
  return { directory, app, call:{name:toolName(app),arguments:{}} };
}

test('sessions and inference consume the same admission budget before eight effects', async t => {
  const f = await fixture(t);
  f.app.media = {sourceAppId:'fixture.exe',deezer:false};
  await fs.writeFile(path.join(f.directory,'applications.json'), JSON.stringify({...DEFAULT_CONFIG,applications:[f.app]}));
  let elapsed = 0, effects = 0;
  const options = [];
  const handle = createAssistant({configDirectory:f.directory,runtimeDirectory:f.directory,now:()=>elapsed,setTimer:()=>0,clearTimer:()=>{},budgetMs:100,
    media:{sessions:async opts=>{options.push(opts);elapsed+=30;return []; }},
    runEngine:async (_exe,_args,opts)=>{options.push(opts);elapsed+=60;return {stdout:JSON.stringify({confidence:1,function_calls:Array(8).fill(f.call)})};},
    launchApplication:async (_app,_args,opts)=>{await opts?.beforeEffect?.();effects++;elapsed+=6;return {success:true,message:'Fixture launched'};}});
  const turn = await handle('process_text',{text:'Lance les applications'});
  assert.equal(effects,2);
  assert.equal(turn.status,'partial');
  assert.deepEqual(turn.results.map(r=>r.outcome),['performed','unknown',...Array(6).fill('not_started')]);
  assert.ok(options[1].timeout<=70);
});

test('an interruption returns known outcomes and confirmation after restart never replays', async t => {
  const f = await fixture(t,{autoExecute:false});
  let elapsed=0,effects=0;
  const make=()=>createAssistant({configDirectory:f.directory,runtimeDirectory:f.directory,now:()=>elapsed,setTimer:()=>0,clearTimer:()=>{},budgetMs:100,
    runEngine:async()=>({stdout:JSON.stringify({confidence:1,function_calls:Array(3).fill(f.call)})}),
    launchApplication:async (_app,_args,opts)=>{await opts.beforeEffect();effects++;elapsed+=effects===1?10:100;return {success:true,message:'Launched'};}});
  const pending=await make()('process_text',{text:'Lance les applications'});
  const turn=await make()('confirm',{id:pending.id});
  assert.deepEqual(turn.results.map(r=>r.outcome),['performed','unknown','not_started']);
  const recovered=await make()('confirm',{id:pending.id});
  assert.deepEqual(recovered.results,turn.results);
  assert.equal(effects,2);
});

test('eight media actions share helper budgets and do not emit after slow discovery', async t => {
  const f=await fixture(t);f.app.media={sourceAppId:'fixture.exe',deezer:false};
  await fs.writeFile(path.join(f.directory,'applications.json'),JSON.stringify({...DEFAULT_CONFIG,applications:[f.app]}));
  let elapsed=0,effects=0;const remainders=[];
  const media=createMedia(async (request,{budget})=>{
    remainders.push(budget.remaining());
    if(request.method==='media_sessions'){
      elapsed+=effects===2?25:10;
      return [{sourceAppId:'fixture.exe',capabilities:{pause:true}}];
    }
    effects++;elapsed+=10;return {accepted:true};
  });
  const handle=createAssistant({configDirectory:f.directory,runtimeDirectory:f.directory,now:()=>elapsed,setTimer:()=>0,clearTimer:()=>{},budgetMs:100,media,
    runEngine:async()=>{elapsed+=30;return {stdout:JSON.stringify({confidence:1,function_calls:Array(8).fill({name:toolsForPause(f.app),arguments:{}})})};}});
  const turn=await handle('process_text',{text:'Mets les lecteurs en pause puis répète'});
  assert.equal(effects,2);assert.equal(turn.status,'partial');
  assert.deepEqual(turn.results.map(r=>r.outcome),['performed','performed',...Array(6).fill('not_started')]);
  assert.deepEqual(remainders,[100,60,50,40,30,20]);
});
function toolsForPause(app){return require('./assistant.cjs').actionToolName(app,'media_pause');}

test('late preparation cannot emit an external effect after the global timer fires', async t => {
  const f=await fixture(t);let effects=0;
  const handle=createAssistant({configDirectory:f.directory,runtimeDirectory:f.directory,budgetMs:60,
    runEngine:async()=>({stdout:JSON.stringify({confidence:1,function_calls:[f.call,f.call]})}),
    launchApplication:async (_app,_args,options)=>{
      await new Promise(resolve=>setTimeout(resolve,150));await options.beforeEffect();effects++;
      return {success:true,message:'Effect'};
    }});
  const started=performance.now();const turn=await handle('process_text',{text:'Lance les applications'});
  assert.ok(performance.now()-started<140);assert.equal(turn.status,'partial');
  assert.deepEqual(turn.results.map(r=>r.outcome),['not_started','not_started']);
  await new Promise(resolve=>setTimeout(resolve,170));assert.equal(effects,0);
});

test('restarting after a crash in an emitted action recovers the journal without replay', async t => {
  const f=await fixture(t,{autoExecute:false});let effects=0;
  const make=()=>createAssistant({configDirectory:f.directory,runtimeDirectory:f.directory,
    runEngine:async()=>({stdout:JSON.stringify({confidence:1,function_calls:[f.call,f.call]})}),
    launchApplication:async (_app,_args,options)=>{
      await options.beforeEffect();effects++;
      const journal=JSON.parse(await fs.readFile(path.join(f.directory,'executions',`${id}.json`),'utf8'));
      assert.equal(journal.turn.results[0].outcome,'unknown');
      const recovered=await make()('confirm',{id});
      assert.equal(recovered.results[0].outcome,'unknown');assert.equal(recovered.results[1].outcome,'not_started');
      const error=new Error('Process interrupted');error.outcome='unknown';throw error;
    }});
  const pending=await make()('process_text',{text:'Lance les applications'});const id=pending.id;
  const turn=await make()('confirm',{id});assert.equal(turn.status,'partial');assert.equal(effects,1);
  assert.equal((await make()('confirm',{id})).results[0].outcome,'unknown');assert.equal(effects,1);
});

test('a host timeout uses the remaining budget and classifies the emitted result as unknown', async () => {
  const sent=[];const host=createHostChannel(line=>sent.push(JSON.parse(line)));
  const budget=createBudget({milliseconds:30});
  const started=performance.now();await assert.rejects(host.request('launch_application',{}, {budget}),error=>error.outcome==='unknown');
  assert.ok(performance.now()-started<150);assert.equal(sent.length,1);assert.ok(sent[0].remainingMs<=30);
  host.receive({type:'host_response',id:sent[0].id,ok:true,result:{accepted:true}});
  host.close();assert.equal(sent.length,1);
});

test('explicit failure is known and does not erase earlier performed actions', async t => {
  const f=await fixture(t);let effects=0;
  const handle=createAssistant({configDirectory:f.directory,runtimeDirectory:f.directory,
    runEngine:async()=>({stdout:JSON.stringify({confidence:1,function_calls:[f.call,f.call,f.call]})}),
    launchApplication:async (_app,_args,options)=>{await options.beforeEffect();effects++;if(effects===2)throw new Error('Refused');return {success:true,message:'Performed'};}});
  const turn=await handle('process_text',{text:'Lance les applications'});
  assert.deepEqual(turn.results.map(r=>r.outcome),['performed','failed','performed']);assert.equal(turn.status,'failed');
});

test('native helper timeout is capped by remaining budget; malformed effect replies are unknown', async () => {
  const {nativeRequest}=require('./native.cjs');
  let elapsed=20;const budget=createBudget({milliseconds:100,now:()=>elapsed});elapsed=85;
  const run=(callbackResult)=>new Promise((resolve,reject)=>{
    const result=nativeRequest({method:'media_action'},{budget,effect:true},'C:\\fixture.exe',(_file,args,options,callback)=>{
      assert.deepEqual(args,['--pam-native']);assert.equal(options.shell,false);assert.equal(options.timeout,35);
      queueMicrotask(()=>callback(...callbackResult));return {stdin:{on(){},end(){}}};
    });result.then(resolve,reject);
  });
  await assert.rejects(run([{killed:true,message:'timeout'},'']),error=>error.outcome==='unknown');
  await assert.rejects(run([null,'malformed']),error=>error.outcome==='unknown');
  await assert.rejects(run([null,JSON.stringify({ok:false,error:'refused'})]),error=>!error.outcome && error.message==='refused');
});
