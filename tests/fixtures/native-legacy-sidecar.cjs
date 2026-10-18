// Read-only historical assistant loaded from a disposable git snapshot.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const profile=process.argv[3];
fs.writeFileSync(path.join(profile,'started.json'),JSON.stringify({pid:process.pid}));
if(process.env.PAM_HISTORY_MODE==='pipe') {setInterval(()=>{},1000);return;}
const handle=require(process.env.PAM_HISTORY_ASSISTANT).createAssistant({runtimeDirectory:profile,configDirectory:profile});
readline.createInterface({input:process.stdin}).on('line',async line=>{
  const request=JSON.parse(line);
  try {process.stdout.write(JSON.stringify({id:request.id,ok:true,result:await handle(request.method,request.payload)})+'\n');}
  catch(error){process.stdout.write(JSON.stringify({id:request.id,ok:false,error:error.message})+'\n');}
});
