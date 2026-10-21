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
  // Reuse the admission deadline through explicit confirmation, with a fake timer
  // so filesystem latency cannot race the simulated clock's last ten milliseconds.
  const budget=createBudget({milliseconds:100,now:()=>elapsed,setTimer:()=>0,clearTimer:()=>{}});
  const pending=await handle('process_text',{text:'Ouvre Fixture huit fois'},{budget});
  assert.equal(pending.status,'pending');assert.equal(effects,0);
  const turn=await handle('confirm',{id:pending.id},{budget});
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
  const handle=make();
  const pending=await handle('process_text',{text:'Ouvre Fixture trois fois'});
  const turn=await handle('confirm',{id:pending.id});
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
  const budget=createBudget({milliseconds:100,now:()=>elapsed,setTimer:()=>0,clearTimer:()=>{}});
  const pending=await handle('process_text',{text:Array(8).fill('Mets Fixture en pause').join(' puis ')},{budget});
  assert.equal(pending.status,'pending');assert.equal(effects,0);
  const turn=await handle('confirm',{id:pending.id},{budget});
  assert.equal(effects,2);assert.equal(turn.status,'partial');
  assert.deepEqual(turn.results.map(r=>r.outcome),['performed','performed',...Array(6).fill('not_started')]);
  assert.deepEqual(remainders,[100,60,50,40,30,20]);
});
function toolsForPause(app){return require('./assistant.cjs').actionToolName(app,'media_pause');}

test('late preparation cannot emit an external effect after the global timer fires', {timeout:10_000}, async t => {
  const f=await fixture(t);let effects=0,elapsed=0,serial=0;
  const timers=new Map();
  const clock={now:()=>elapsed,setTimer:callback=>{const id=++serial;timers.set(id,callback);return id;},clearTimer:id=>timers.delete(id)};
  let enterPreparation,releasePreparation,finishLatePreparation;
  const entered=new Promise(resolve=>{enterPreparation=resolve;});
  const preparation=new Promise(resolve=>{releasePreparation=resolve;});
  const lateFinished=new Promise(resolve=>{finishLatePreparation=resolve;});
  t.after(()=>releasePreparation());
  const handle=createAssistant({configDirectory:f.directory,runtimeDirectory:f.directory,budgetMs:60,...clock,
    runEngine:async()=>({stdout:JSON.stringify({confidence:1,function_calls:[f.call,f.call]})}),
    launchApplication:async (_app,_args,options)=>{
      enterPreparation();
      try {
        await preparation;await options.beforeEffect();effects++;
        return {success:true,message:'Effect'};
      } finally {finishLatePreparation();}
    }});
  const pending=await handle('process_text',{text:'Ouvre Fixture deux fois'});
  assert.equal(pending.status,'pending');assert.equal(effects,0);
  const confirming=handle('confirm',{id:pending.id});
  await entered;assert.equal(effects,0);assert.ok(timers.size>0);
  // Expire the real production budget's registered timer while preparation stays
  // blocked. Filesystem/runner scheduling cannot consume this logical clock.
  elapsed=60;
  for(const timer of [...timers.values()])timer();
  const turn=await confirming;
  assert.equal(turn.status,'partial');assert.equal(effects,0);
  assert.deepEqual(turn.results.map(r=>r.outcome),['not_started','not_started']);
  releasePreparation();await lateFinished;assert.equal(effects,0);
  assert.equal(timers.size,0);
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
  const handle=make();
  const pending=await handle('process_text',{text:'Ouvre Fixture deux fois'});const id=pending.id;
  const turn=await handle('confirm',{id});assert.equal(turn.status,'partial');assert.equal(effects,1);
  assert.equal((await make()('confirm',{id})).results[0].outcome,'unknown');assert.equal(effects,1);
});

test('a host timeout uses the remaining budget and classifies the emitted result as unknown', async () => {
  const sent=[];const host=createHostChannel(line=>sent.push(JSON.parse(line)));
  host.setContext('11111111-1111-4111-8111-111111111111');
  const budget=createBudget({milliseconds:30});
  const started=performance.now();await assert.rejects(host.request('launch_application',{executable:'C:\\fixture.exe',arguments:[]}, {budget}),error=>error.outcome==='unknown');
  assert.ok(performance.now()-started<150);assert.equal(sent.length,1);assert.ok(sent[0].remainingMs<=30);
  host.receive({type:'host_response',id:sent[0].id,ok:true,result:{accepted:true}});
  host.close();assert.equal(sent.length,1);
});

test('explicit failure is known and does not erase earlier performed actions', async t => {
  const f=await fixture(t);let effects=0;
  const handle=createAssistant({configDirectory:f.directory,runtimeDirectory:f.directory,
    runEngine:async()=>({stdout:JSON.stringify({confidence:1,function_calls:[f.call,f.call,f.call]})}),
    launchApplication:async (_app,_args,options)=>{await options.beforeEffect();effects++;if(effects===2)throw new Error('Refused');return {success:true,message:'Performed'};}});
  const pending=await handle('process_text',{text:'Ouvre Fixture trois fois'});
  assert.equal(pending.status,'pending');assert.equal(effects,0);
  const turn=await handle('confirm',{id:pending.id});
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
