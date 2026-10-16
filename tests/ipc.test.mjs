import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const runtime=require('../sidecar/contracts.cjs');
function client(invoke) {
  const code=ts.transpileModule(readFileSync(new URL('../src/ipc.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};new Function('require','exports',code)(name=>name.includes('/api/core')?{invoke}:name.includes('contract-runtime')?runtime:{PROTOCOL_VERSION:1},exports);return exports;
}
test('Vue rejects invalid methods and payloads without invoking native services',async()=>{
  let effects=0;const ipc=client(async()=>{effects++;});
  await assert.rejects(ipc.request('unknown',{}));
  await assert.rejects(ipc.request('confirm',{id:42}));
  await assert.rejects(ipc.desktopAction('unknown'));
  await assert.rejects(ipc.request('voice_shortcut',{shortcut:'Alt+F4'}));
  await assert.rejects(ipc.request('voice_shortcut',{shortcut:'ctrl_alt_space',unexpected:true}));
  assert.equal(effects,0);
});
test('Vue ignores wrong version, mismatched request and stale response before returning data',async()=>{
  for(const change of [v=>({...v,version:2}),v=>({...v,id:v.id-1}),v=>({...v,requestId:'old'}),v=>({...v,method:'confirm'}),v=>({...v,result:{wrong:true}})]) {
    let calls=0;const ipc=client(async(_,{request})=>{calls++;return change({...request,ok:true,result:'exported'});});
    await assert.rejects(ipc.request('export_config'));assert.equal(calls,1,'Never retry an uncertain effect');
  }
  const ipc=client(async(_,{request})=>({...request,ok:true,result:'exported'}));
  assert.equal(await ipc.request('export_config'),'exported');
});
test('Vue validates errors, discovery and native action results',async()=>{
  const error=require('../sidecar/diagnostics.cjs').envelope('request_timeout','11111111-1111-4111-8111-111111111111');
  const ipc=client(async(_,{request})=>({...request,ok:false,error:{...error,requestId:request.requestId}}));
  await assert.rejects(ipc.request('export_config'),e=>e.code==='request_timeout');
  await assert.rejects(client(async()=>[{appId:42}]).discoverApplications());
  await assert.rejects(client(async()=>({unexpected:true})).desktopAction('hide'));
});
test('TypeScript rejects cross-method payloads and wrong response types',()=>{
  const program=ts.createProgram(['tests/fixtures/contracts.typecheck.ts'],{noEmit:true,strict:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,resolveJsonModule:true});
  const diagnostics=ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[]);
});
