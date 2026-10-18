// Negative controls use actual pre-fix Git sources, never production mutations.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
assert.equal(process.platform,'win32');
const revision='2aff3f94cf8c3cc0e6266f59f2739b0a977ae122';
await mkdir(join(root,'.runtime-cache'),{recursive:true});
const temp=await mkdtemp(join(root,'.runtime-cache/native-history-'));
const show=file=>execFileSync('git',['show',`${revision}:${file}`],{cwd:root,maxBuffer:5_000_000});
function run(file,args,env=process.env) {
  const r=spawnSync(file,args,{cwd:root,env,encoding:'utf8',windowsHide:true,shell:false,timeout:30_000});
  assert.ifError(r.error);console.log(r.stdout);if(r.stderr)console.log(r.stderr);return r;
}
try {
  const sidecars=execFileSync('git',['ls-tree','-r','--name-only',revision,'sidecar'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/);
  for(const file of sidecars){const target=join(temp,file);await mkdir(dirname(target),{recursive:true});await writeFile(target,show(file));}
  const legacy=join(temp,'sidecar/assistant.cjs');
  const budget=run(process.execPath,[join(root,'tests/fixtures/native-budget-probe.cjs'),legacy]);
  assert.equal(budget.status,1);assert.match(budget.stdout,/"effects":8/);assert.match(budget.stderr,/PAM-03: admission budget/);
  assert.equal(run(process.execPath,[join(root,'tests/fixtures/native-budget-probe.cjs'),join(root,'sidecar/assistant.cjs')]).status,0);
  const lib=show('src-tauri/src/lib.rs').toString();
  const bridge=lib.slice(lib.indexOf('#[cfg(windows)]\nstruct ProcessJob'),lib.indexOf('fn runtime_path('));
  assert.ok(bridge.startsWith('#[cfg(windows)]'));assert.match(bridge,/worker.stdin.write_all/);
  const imports='use serde_json::{json,Value}; use std::{io::{BufRead,BufReader,Read,Write},path::PathBuf,process::{Child,ChildStdin,Command,Stdio},sync::{atomic::{AtomicBool,Ordering},mpsc,Arc,Mutex},time::Duration};\n';
  const include=JSON.stringify(join(root,'tests/fixtures/native-legacy-probe.rs'));
  const source=join(temp,'legacy.rs');await writeFile(source,imports+bridge+`\ninclude!(${include});\n`);
  const deps=join(process.env.CARGO_TARGET_DIR??join(root,'src-tauri/target'),'x86_64-pc-windows-msvc/debug/deps');
  const files=await readdir(deps);
  const externs=[];
  for(const name of ['serde_json','windows_sys']) {
    let library;
    for(const f of files.filter(f=>f.startsWith(`lib${name}-`)&&f.endsWith('.rlib'))) {
      if(name==='windows_sys') {
        const hash=f.slice('libwindows_sys-'.length,-'.rlib'.length);
        const metadata=await readFile(join(dirname(deps),'.fingerprint',`windows-sys-${hash}`,'lib-windows_sys.json'),'utf8');
        if(!JSON.parse(metadata).features.includes('Win32_System_JobObjects'))continue;
      }
      library=f;break;
    }
    assert.ok(library,`compiled dependency ${name} missing`);
    externs.push('--extern',`${name}=${join(deps,library)}`);
  }
  const binary=join(temp,'legacy.exe');
  assert.equal(run(process.argv[2]??'rustc',['--edition','2021','--target','x86_64-pc-windows-msvc','-Awarnings','-L',`dependency=${deps}`,...externs,source,'-o',binary]).status,0);
  for(const mode of ['pipe','job']) {
    const profile=join(temp,mode);await mkdir(profile);
    const result=run(binary,[mode,join(root,'src-tauri/binaries/pam-node-x86_64-pc-windows-msvc.exe'),join(root,'tests/fixtures/native-legacy-sidecar.cjs'),profile,resolve(process.argv[3])],{...process.env,PAM_HISTORY_MODE:mode,PAM_HISTORY_ASSISTANT:legacy});
    assert.equal(result.status,1,`initial ${mode} behavior must fail the corrected predicate`);
    assert.match(result.stdout,/"passed":false/);
  }
  console.log('PASS historical negative controls: PAM-01 kills inherited fixture, PAM-03 emits eight effects, PAM-04 blocks stdin; current budget probe passes.');
} finally {
  assert.equal(dirname(temp),join(root,'.runtime-cache'));
  await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
