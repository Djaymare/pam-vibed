const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createAssistant, DEFAULT_CONFIG } = require('./assistant.cjs');
const { envelope, failure, maskMessage } = require('./diagnostics.cjs');
const ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'SENTINEL-voice-audio-transcription-argument';
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-diagnostics-'));
  t.after(() => fs.rm(directory, {recursive:true,force:true}));
  // The profile describes Windows targets even when the model-free suite runs on Linux.
  const executable = process.platform === 'win32' ? process.execPath : 'C:\\PAM-fixture\\node.exe';
  const config = {...DEFAULT_CONFIG,applications:[{id:ID,name:'Test',description:'Test fixture',executable,arguments:[],aliases:[],enabled:true}]};
  await fs.writeFile(path.join(directory,'applications.json'),JSON.stringify(config));
  const events = [], context = {requestId:ID,onDiagnostic:error=>events.push(error)};
  const handle=createAssistant({runtimeDirectory:directory,configDirectory:directory,...options});
  return {directory,handle,events,context};
}
test('model and transcription failures retain a stage and correlation without engine output or audio', async t => {
  const f=await fixture(t,{runEngine:async()=>{throw Error(`C:\\Users\\Private\\${SECRET}`);}});
  await assert.rejects(f.handle('process_text',{text:SECRET},f.context),e=>e.diagnostic.code==='model_failure' && e.diagnostic.stage==='inference');
  const wav=Buffer.alloc(46); wav.write('RIFF');wav.writeUInt32LE(38,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2,40);
  await assert.rejects(f.handle('process_audio',{audio:[...wav]},f.context),e=>e.diagnostic.code==='model_failure' && e.diagnostic.stage==='transcription');
  assert.ok(f.events.length>=2); assert.ok(f.events.every(e=>e.requestId===ID)); assert.doesNotMatch(JSON.stringify(f.events),/SENTINEL|Private|Users|\.wav/);
});
test('corrupt profile, missing target and timeout have distinct envelopes and actionable messages', async t => {
  const f=await fixture(t,{budgetMs:0});
  const timeout=await f.handle('process_text',{text:SECRET},f.context);assert.equal(timeout.error.code,'request_timeout');assert.equal(timeout.error.retryable,false);
  const g=await fixture(t);await fs.writeFile(path.join(g.directory,'applications.json'),`{"executable":"C:\\Users\\${SECRET}`);
  const status=await g.handle('status',{},g.context);assert.equal(status.error.code,'invalid_profile');assert.match(status.error.message,/Restaurez/);
  await assert.rejects(g.handle('process_text',{text:SECRET},g.context),e=>e.diagnostic.code==='invalid_profile');
  const h=await fixture(t);await assert.rejects(h.handle('delete_application',{id:'absent'},h.context),e=>e.diagnostic.code==='target_missing');
  assert.doesNotMatch(JSON.stringify([...f.events,...g.events,...h.events]),/SENTINEL|Private|Users/);
});
test('closed diagnostic schema drops all unexpected properties, messages and unsafe stages', () => {
  for(const code of ['model_failure','microphone_denied','target_missing','request_timeout','invalid_profile']) {
    const diagnostic=failure({code:'anything',message:SECRET,audio:SECRET,transcript:SECRET,arguments:[SECRET]}, {requestId:ID},code,SECRET);
    assert.equal(diagnostic.code,code);assert.equal(diagnostic.requestId,ID);assert.equal(typeof diagnostic.retryable,'boolean');
    assert.doesNotMatch(JSON.stringify(diagnostic),/SENTINEL/);assert.deepEqual(diagnostic.technical,{category:code});
  }
  assert.equal(envelope('__proto__',ID).code,'invalid_request');
  assert.doesNotMatch(maskMessage(`failed: C:\\Users\\Private\\${SECRET}`),/Users|Private|SENTINEL/);
});
