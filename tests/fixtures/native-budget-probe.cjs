// Same controlled admission scenario against historical and current assistants.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createBudget} = require('../../sidecar/budget.cjs');
async function run(assistantFile) {
  const {createAssistant,DEFAULT_CONFIG,toolName} = require(assistantFile);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(),'pam-native-budget-'));
  try {
    const app={id:'11111111-1111-4111-8111-111111111111',name:'Fixture',aliases:[],description:'Fixture',executable:'C:\\fixture.exe',arguments:[],enabled:true,media:{sourceAppId:'fixture.exe',deezer:false}};
    await fs.writeFile(path.join(profile,'applications.json'),JSON.stringify({...DEFAULT_CONFIG,autoExecute:false,applications:[app]}));
    let elapsed=0,effects=0;
    const timers={now:()=>elapsed,setTimer:()=>0,clearTimer:()=>{}};
    const handle=createAssistant({configDirectory:profile,runtimeDirectory:profile,...timers,budgetMs:100,
      media:{sessions:async()=>{elapsed+=30;return [];}},
      runEngine:async()=>{elapsed+=60;return {stdout:JSON.stringify({confidence:1,function_calls:Array(8).fill({name:toolName(app),arguments:{}})})};},
      launchApplication:async(_app,_args,opts)=>{await opts?.beforeEffect?.();effects++;elapsed+=6;return {success:true,message:'Simulated effect'};}});
    const budget=createBudget({milliseconds:100,...timers});
    const pending=await handle('process_text',{text:'Ouvre Fixture huit fois'},{budget});
    assert.equal(pending.status,'pending');
    const turn=await handle('confirm',{id:pending.id},{budget});
    console.log(JSON.stringify({regression:'PAM-03',effects,status:turn.status,outcomes:turn.results.map(r=>r.outcome)}));
    assert.equal(effects,2,'PAM-03: admission budget must prevent six later emissions');
    assert.equal(turn.status,'partial');
    assert.deepEqual(turn.results.map(r=>r.outcome),['performed','unknown',...Array(6).fill('not_started')]);
  } finally {
    assert.equal(path.dirname(profile),os.tmpdir());
    await fs.rm(profile,{recursive:true,force:true});
  }
}
run(path.resolve(process.argv[2])).catch(error=>{console.error(error);process.exitCode=1;});
