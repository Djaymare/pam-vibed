// Read-only evidence inventory. Never reads account storage, cookies or tokens.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
assert.equal(process.platform,'win32','L’inventaire du paquet installé nécessite Windows.');
const run=promisify(execFile);
const {stdout}=await run('powershell.exe',['-NoProfile','-Command',"Get-AppxPackage -Name Deezer.62021768415AF | Select-Object Version,PackageFamilyName,InstallLocation | ConvertTo-Json -Compress"],{windowsHide:true});
assert.ok(stdout.trim(),'Deezer Music du Store est absent.');
const installed=JSON.parse(stdout);assert.ok(!Array.isArray(installed),'Plusieurs paquets Deezer trouvés.');
const manifest=await readFile(join(installed.InstallLocation,'AppxManifest.xml'),'utf8');
const bytes=await readFile(join(installed.InstallLocation,'app/resources/app.asar'));
const headerSize=bytes.readUInt32LE(4), jsonSize=bytes.readUInt32LE(12);
assert.ok(jsonSize>0 && jsonSize<=headerSize && 8+headerSize<=bytes.length,'En-tête ASAR invalide.');
const header=JSON.parse(bytes.subarray(16,16+jsonSize).toString('utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
function entry(name) {
  let node=header;for(const part of name.split('/'))node=node.files?.[part];
  assert.ok(node && !node.unpacked && node.offset!==undefined,`Entrée ASAR absente : ${name}`);
  const start=8+headerSize+Number(node.offset);assert.ok(start+node.size<=bytes.length,'Entrée ASAR hors limites.');
  return bytes.subarray(start,start+node.size);
}
const main=entry('build/main.js'),preload=entry('build/preload.js');
const text=main.toString('utf8');
const report={date:new Date().toISOString(),installed,
  schemes:[...manifest.matchAll(/<[^>]*Protocol\s+Name="([^"]+)"/g)].map(m=>m[1]),
  sources:{'app.asar':sha(bytes),'build/main.js':sha(main),'build/preload.js':sha(preload)},
  desktopMarkers:Object.fromEntries(['app-go-to-raw','www.deezer.com','/autolog','/flushCache','/reload'].map(marker=>[marker,text.includes(marker)]))};
if(process.argv.includes('--web')) {
  // Pinned public assets used by the dated inventory; these can disappear.
  report.publicSources=[];
  for(const url of ['https://cdn-files.dzcdn.net/cache/js/route-deeplink.be0caa3b324f13abde1f.js','https://cdn-files.dzcdn.net/cache/js/app-web.6399ee357b7a19c0f09e.js']) {
    const response=await fetch(url,{signal:AbortSignal.timeout(15000)});assert.ok(response.ok,`HTTP ${response.status} : ${url}`);
    const source=Buffer.from(await response.arrayBuffer());report.publicSources.push({url,sha256:sha(source),bytes:source.length});
  }
}
console.log(JSON.stringify(report,null,2));
