// Disposable IPC fixture; synthetic temporary bytes and simulated effects only.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const profile=process.argv[3],mode=fs.readFileSync(path.join(profile,'mode'),'utf8').trim();
if(mode==='recovered-temporary') { require('../../sidecar/main.cjs'); return; }
fs.writeFileSync(path.join(profile,'started.json'),JSON.stringify({pid:process.pid,mode}));
setInterval(()=>{},1000);
if(mode==='crash-temporary') {
  void (async()=>{
    const turn=await require('../../sidecar/temporary-files.cjs').createTemporaryFiles(profile).createTurn();
    fs.writeFileSync(path.join(turn.directory,'clip.wav'),'SYNTHETIC_WAV');
    fs.writeFileSync(path.join(turn.directory,'keywords.txt'),'SYNTHETIC_KEYWORDS');
    fs.appendFileSync(path.join(profile,'effects'),'once\n'); // simulated already-emitted effect
    process.exit(70);
  })();
} else if(mode==='startup-fail') {
  const helper=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{shell:false,windowsHide:true,stdio:['ignore','inherit','ignore']});
  helper.once('spawn',()=>{
    fs.appendFileSync(path.join(profile,'failed-pids'),JSON.stringify({pid:process.pid,helper:helper.pid})+'\n');
    process.exit(70);
  });
} else if(mode==='never-read-child') {
  const helper=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{shell:false,windowsHide:true,stdio:['inherit','inherit','ignore']});
  helper.once('spawn',()=>fs.writeFileSync(path.join(profile,'started.json'),JSON.stringify({pid:process.pid,mode,helper:helper.pid})));
} else if(mode!=='never-read') {
  let activeId;
  readline.createInterface({input:process.stdin}).on('line',line=>{
    const request=JSON.parse(line);
    const send=(body,callback)=>process.stdout.write(JSON.stringify({version:1,requestId:request.requestId,...body})+'\n',callback);
    if(mode==='host-missing') {
      if(request.type==='host_response')send({id:activeId,ok:false,error:request.error});
      else {activeId=request.id;send({type:'host_request',id:'11111111-1111-4111-8111-111111111111',method:'launch_application',payload:{executable:path.join(profile,'absent-SENTINEL.exe'),arguments:[]}});}
      return;
    }
    if(mode==='diagnostic') {
      const secret='SENTINEL_AUDIO_TRANSCRIPTION_ARGS_C:\\Users\\Private';process.stderr.write(secret);
      const error={code:'model_failure',stage:'transcription',requestId:request.requestId,message:secret,technical:{raw:secret},audio:secret};
      send({type:'diagnostic',id:request.id,error});send({id:request.id,ok:false,error:require('../../sidecar/diagnostics.cjs').envelope('model_failure',request.requestId,'transcription')});return;
    }
    fs.appendFileSync(path.join(profile,'budgets'),request.remainingMs+'\n');
    if(mode==='eof')process.exit(0);
    fs.appendFileSync(path.join(profile,'executions'),(request.payload?.text??request.method)+'\n');
    const turn={id:'11111111-1111-4111-8111-111111111111',transcript:request.payload?.text??'',language:'fr',confidence:null,reasoning:String(process.pid),durationMs:0,calls:[],results:[],status:'unsupported'};
    const status={ready:false,checks:[],manifest:null,config:{version:2,applications:[],language:'fr',autoExecute:false,confidenceThreshold:0.7},configDirectory:profile,engine:null};
    const reply=()=>send({id:request.id,ok:true,result:request.method==='status'?status:turn});
    if(mode==='stale-response') { send({id:request.id-1,ok:true,result:turn});send({requestId:'22222222-2222-4222-8222-222222222222',id:request.id,ok:true,result:turn});reply();return; }
    if(mode==='wrong-version') { send({version:2,id:request.id,ok:true,result:turn});return; }
    if(mode==='invalid-result') {send({id:request.id,ok:true,result:{status:'executed'}});return;}
    if(mode==='invalid-error') {send({id:request.id,ok:false,error:{code:'model_failure',retryable:'yes'}});return;}
    if(mode==='invalid-host') {send({type:'host_request',id:'11111111-1111-4111-8111-111111111111',method:'launch_application',payload:{executable:process.execPath,arguments:['-e',"require('node:fs').writeFileSync(process.argv[1],'effect')",path.join(profile,'forbidden-effect')],unexpected:true}});return;}
    if(mode==='partial-timeout'||mode==='partial-eof') {
      turn.status='partial';turn.calls=['first','second','third'].map(name=>({name,arguments:{},applicationId:'fixture',applicationName:'Fixture'}));
      turn.results=['performed','unknown','not_started'].map((outcome,i)=>({outcome,success:i===0,applicationName:'Fixture',message:'Fixture outcome'}));
      send({type:'turn_progress',id:request.id,turn},()=>{if(mode==='partial-eof')process.exit(0);});
    } else if(mode==='invalid-progress')send({type:'turn_progress',id:request.id+1,turn:{}});
    else if(mode==='late')setTimeout(reply,1500);
    else if(mode!=='silent')reply();
  });
}
