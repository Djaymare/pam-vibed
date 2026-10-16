const test=require('node:test');
const assert=require('node:assert/strict');
const {launch}=require('./assistant/executor.cjs');
test('PAM-22 a successful disposable spawn reports emission without claiming observed opening',async()=>{
  let emitted=0;
  const result=await launch({name:'Node Fixture',executable:process.execPath,arguments:['-e','process.exit(0)']},{},{beforeEffect:()=>{emitted++;}});
  assert.equal(emitted,1);assert.equal(result.success,true);assert.match(result.message,/envoyée.*pas observée/);assert.doesNotMatch(result.message,/lancé\./);
});
