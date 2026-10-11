// Windows-only integration. Default mode never changes playback.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const { nativeRequest } = require('../sidecar/native.cjs');
const { createMedia } = require('../sidecar/media.cjs');
const { createAssistant, DEFAULT_CONFIG } = require('../sidecar/assistant.cjs');
const { createEngine } = require('../sidecar/engine.cjs');
const { DEEZER_APP_ID, deezerUri } = require('../sidecar/deezer.cjs');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.platform, 'win32', 'Ce test utilise GSMTC sur Windows.');
let executable = process.env.PAM_NATIVE_EXE;
if (!executable) {
  for (const name of ['artifacts/PAM-windows-media-deezer/PAM.exe', 'src-tauri/target/x86_64-pc-windows-msvc/release/examples/media.exe']) {
    const file = join(root, name);
    if (await stat(file).catch(() => null)) { executable = file; break; }
  }
}
assert.ok(executable, 'Compiler PAM ou l’exemple media, ou définir PAM_NATIVE_EXE.');
const native = request => nativeRequest(request, executable);
const media = createMedia(native);
const cache = join(root, '.runtime-cache');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(join(cache, 'smoke-media-'));
const report = { date: new Date().toISOString(), native: executable, checks: [] };
function record(test, result) { report.checks.push({ test, ...result }); console.log(test, JSON.stringify(result)); }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(probe, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await delay(250); }
  throw new Error(message);
}
function summary(s) { return {sourceAppId:s.sourceAppId, playbackStatus:s.playbackStatus, capabilities:s.capabilities, ...(s.error ? {error:s.error} : {})}; }
const deezer = { name:'Deezer', aliases:['Diseur'], description:'Écoute de musique', enabled:true,
  executable:join(process.env.SystemRoot, 'explorer.exe'), arguments:[`shell:AppsFolder\\${DEEZER_APP_ID}`],
  windowsApp:{appId:DEEZER_APP_ID,kind:'store',icon:null}, media:{sourceAppId:'Deezer.exe',deezer:true} };
const run = promisify(execFile);
const engine = createEngine(join(root, 'src-tauri/runtime'));
const resources = [];
try {
  const sessions = await media.sessions(); assert.ok(Array.isArray(sessions));
  record('sessions Windows', {sessions:sessions.map(summary)});
  await assert.rejects(native({method:'media_action',sourceAppId:'PAM.fixture.absent',action:'play'}), /Aucune session/);
  await assert.rejects(native({method:'deezer_open',uri:'deezer://www.deezer.com/flushCache'}), /non autorisé/);
  record('cible absente et route non autorisée', {passed:true});
  const handle = createAssistant({configDirectory:profile, runtimeDirectory:join(root,'src-tauri/runtime'), engine, runEngine:engine.runEngine, media});
  const app = {...deezer,id:'11111111-1111-4111-8111-111111111111'};
  await writeFile(join(profile,'applications.json'),JSON.stringify({...DEFAULT_CONFIG,applications:[app]}));
  await handle('settings', {language:'fr',autoExecute:false,confidenceThreshold:0.7});
  const cases = [
    ['Afficher la chanson 3135556 dans Deezer', 'deezer_content'],
    ['Rechercher Daft Punk dans Deezer', 'deezer_search'],
    ['Démarrer Flow dans Deezer', 'deezer_start'],
  ];
  const live = sessions.filter(s => s.sourceAppId === 'Deezer.exe');
  if (live.length === 1 && !live[0].error) {
    for (const [action,text] of [['play','Joue Diseur'],['pause','Pause Diseur'],['next','Piste suivante Diseur']])
      if (live[0].capabilities?.[action]) cases.push([text,`media_${action}`]);
  }
  for (const [text,action] of cases) {
    const turn = await handle('process_text', {text});
    if (turn.calls.length !== 1 || turn.calls[0]?.action !== action) console.error('Routage inattendu', JSON.stringify(turn));
    assert.equal(turn.status,'pending',text); assert.equal(turn.calls.length,1,text);
    assert.equal(turn.calls[0].action,action,text); assert.equal(turn.calls[0].applicationId,app.id,text);
    await handle('discard',{id:turn.id});
    record('Needle : ' + text,{action,confidence:turn.confidence,executed:false});
  }
  for (const text of ['Joue la chanson 3135556 dans Diseur','Ajoute la chanson 3135556 dans la file en prochaine position sur Diseur']) {
    const turn=await handle('process_text',{text});assert.equal(turn.status,'unsupported');assert.equal(turn.calls.length,0);
    record(text,{unsupported:true,message:turn.message});
  }
  if (process.argv.includes('--deezer')) {
    const current = () => native({method:'media_sessions'}).then(list => list.filter(s=>s.sourceAppId==='Deezer.exe'));
    const initial = await current(); assert.ok(initial.length <= 1, 'Sessions Deezer ambiguës.');
    const restorePlaying = initial[0]?.playbackStatus === 'Lecture';
    try {
      assert.equal((await native({method:'deezer_open',uri:deezerUri('deezer_start',{mix:'flow'})})).accepted,true);
      await until(async()=>{const s=await current();return s.length===1 && s[0].capabilities.pause && s[0];},'Flow ne publie pas de session en lecture.');
      await media.execute(deezer,'media_pause',{});
      await until(async()=>{const s=await current();return s.length===1 && s[0].playbackStatus==='Pause';},'Pause non observée.');
      await media.execute(deezer,'media_play',{});
      const playing = await until(async()=>{const s=await current();return s.length===1 && s[0].playbackStatus==='Lecture' && s[0];},'Lecture non observée.');
      await media.execute(deezer,'media_next',{});
      await until(async()=>{const s=await current();return s.length===1 && s[0].title!==playing.title && s[0];},'Changement de titre non observé.');
      await media.execute(deezer,'media_pause',{});
      const paused=await until(async()=>{const s=await current();return s.length===1 && s[0].playbackStatus==='Pause' && s[0];},'Pause finale non observée.');
      const link=await media.execute(deezer,'deezer_content',{kind:'track',id:'3135556'});
      await delay(1500);const after=await current();assert.equal(after.length,1);
      assert.equal(after[0].title,paused.title);assert.equal(after[0].playbackStatus,'Pause');
      record('Deezer Music réel',{flow:true,play:true,pause:true,nextTitleChanged:true,contentNavigationAccepted:link.success,contentDidNotStartSong:true,session:summary(after[0])});
    } finally {
      const s=await current();const action=restorePlaying?'play':'pause';
      if(s.length===1 && s[0].capabilities?.[action]) await media.execute(deezer,`media_${action}`,{});
    }
  }
  if (process.argv.includes('--players')) {
    // Two silent local files; no personal playlist or browser profile is touched.
    const wav = Buffer.alloc(44+16000*2*90);
    wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
    wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);
    wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
    const first=join(profile,'PAM-media-1.wav'),second=join(profile,'PAM-media-2.wav');
    await writeFile(first,wav);await writeFile(second,wav);
    const vlc = process.env.PAM_VLC_EXE || 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe';
    if (await stat(vlc).catch(()=>null)) {
      const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
      const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
      const child=spawn(vlc,['--ignore-config','--no-one-instance','--no-video','--extraintf=http','--http-host=127.0.0.1',`--http-port=${port}`,'--http-password=pam-fixture',first,second],{windowsHide:true,stdio:'ignore',env:{...process.env,PAM_PROFILE_DIR:profile}});
      child.on('error',()=>{});resources.push(async()=>{if(child.exitCode===null && child.pid) await run('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});});
      await until(async()=>{try { const r=await fetch(`http://127.0.0.1:${port}/requests/status.json`,{headers:{Authorization:'Basic '+Buffer.from(':pam-fixture').toString('base64')}});return (await r.json()).state==='playing'; } catch{return false;}},'Le VLC de test ne lit pas le fichier.');
      await delay(1500);const matches=(await media.sessions()).filter(s=>/vlc/i.test(s.sourceAppId));
      record('VLC réel',{localAudioPlaying:true,gsmtcSessions:matches.map(summary),compatible:matches.length===1 && !matches[0].error});
      if(matches.length===1 && /PAM-media-[12]/.test(matches[0].title || '') && matches[0].capabilities?.pause && matches[0].capabilities?.play) {
        const target={name:'VLC de test',media:{sourceAppId:matches[0].sourceAppId}};
        await media.execute(target,'media_pause',{});await media.execute(target,'media_play',{});
        if(matches[0].capabilities.next)await media.execute(target,'media_next',{});
      }
    } else record('VLC réel',{skipped:'VLC absent ; définir PAM_VLC_EXE.'});
    const browser = process.env.PAM_BROWSER_EXE || join(process.env.LOCALAPPDATA,'Programs/Opera GX/opera.exe');
    if(await stat(browser).catch(()=>null)) {
      let state={ready:false};
      const html=`<!doctype html><meta charset="utf-8"><title>PAM Media fixture</title><h1>PAM Media fixture</h1><audio id="a" src="/audio.wav" loop controls></audio><button onclick="a.play()">Lire le silence</button><script>
        let index=1;function notify(){fetch('/state?playing='+!a.paused+'&index='+index).catch(()=>{});}
        function metadata(){navigator.mediaSession.metadata=new MediaMetadata({title:'PAM Media fixture '+index,artist:'PAM integration test'});}
        if('mediaSession' in navigator){metadata();navigator.mediaSession.setActionHandler('play',()=>a.play());navigator.mediaSession.setActionHandler('pause',()=>a.pause());navigator.mediaSession.setActionHandler('nexttrack',()=>{index++;metadata();notify();});}
        a.onplay=()=>{navigator.mediaSession.playbackState='playing';notify();};a.onpause=()=>{navigator.mediaSession.playbackState='paused';notify();};a.play().catch(()=>notify());</script>`;
      const server=createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/state'){state={ready:true,playing:url.searchParams.get('playing')==='true',index:Number(url.searchParams.get('index'))};res.end('ok');}else if(url.pathname==='/audio.wav'){res.setHeader('Content-Type','audio/wav');res.end(wav);}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));resources.push(()=>new Promise(resolve=>server.close(resolve)));
      const browserProfile=join(profile,'browser');
      const child=spawn(browser,[`--user-data-dir=${browserProfile}`,'--no-first-run','--no-default-browser-check','--autoplay-policy=no-user-gesture-required',`http://127.0.0.1:${server.address().port}`],{windowsHide:true,stdio:'ignore',env:{...process.env,PAM_PROFILE_DIR:profile}});child.on('error',()=>{});
      resources.push(async()=>{
        const {stdout}=await run('powershell.exe',['-NoProfile','-Command',"Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(opera|chrome|msedge)\\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains($env:PAM_MEDIA_BROWSER_PROFILE) } | Select-Object -ExpandProperty ProcessId"],{windowsHide:true,env:{...process.env,PAM_MEDIA_BROWSER_PROFILE:browserProfile}});
        for(const id of stdout.trim().split(/\s+/).filter(id=>/^\d+$/.test(id)))await run('taskkill.exe',['/PID',id,'/T','/F'],{windowsHide:true}).catch(()=>{});
      });
      await until(()=>state.ready,'La page de test du navigateur ne répond pas.');
      await delay(2000);
      const sessions=await media.sessions(), fixtures=sessions.filter(s=>s.title?.startsWith('PAM Media fixture '));
      const selected=fixtures[0], matching=selected?sessions.filter(s=>s.sourceAppId===selected.sourceAppId):[];
      record('Navigateur réel',{fixtureAudioPlaying:state.playing,fixtureSessions:fixtures.map(summary),sameSourceSessions:matching.length,ambiguous:matching.length>1});
      if(selected && matching.length===1 && state.playing) {
        const target={name:'Navigateur de test',media:{sourceAppId:selected.sourceAppId}};
        let pauseObserved=false;
        if(selected.capabilities.pause){await media.execute(target,'media_pause',{});await until(()=>!state.playing,'Pause du navigateur non observée.');pauseObserved=true;}
        if((await media.sessions()).find(s=>s.sourceAppId===selected.sourceAppId)?.capabilities.play){await media.execute(target,'media_play',{});await until(()=>state.playing,'Lecture du navigateur non observée.');}
        if(selected.capabilities.next){await media.execute(target,'media_next',{});await until(()=>state.index===2,'Piste suivante du navigateur non observée.');}
        record('Commandes navigateur',{play:state.playing,pauseObserved,nextObserved:state.index===2});
      } else if(selected && matching.length>1) {
        await assert.rejects(native({method:'media_action',sourceAppId:selected.sourceAppId,action:'pause'}),/Plusieurs sessions/);
        record('Navigateur ambigu',{refused:true,personalPlaybackUntouched:true});
      }
    } else record('Navigateur réel',{skipped:'Navigateur absent ; définir PAM_BROWSER_EXE.'});
  }
} finally {
  await engine.close();
  for(const cleanup of resources.reverse())await cleanup();
  await mkdir(join(root,'artifacts'),{recursive:true});
  const suffix=process.argv.includes('--players')?'players':process.argv.includes('--deezer')?'deezer':'routing';
  await writeFile(join(root,`artifacts/media-${suffix}-results.json`),JSON.stringify(report,null,2)+'\n');
  assert.equal(dirname(resolve(profile)),resolve(cache));assert.ok(profile.startsWith(join(cache,'smoke-media-')));
  await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:250});
}
console.log('Intégration multimédia Windows : OK');
