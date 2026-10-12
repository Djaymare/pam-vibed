// Disposable frontend services. Never invoke a real application or microphone.
let scenario = new URLSearchParams(location.search).get('state') || 'ready';
const app = {id:'11111111-1111-4111-8111-111111111111',name:'Lecteur de test',description:'Application simulée pour les mesures de lisibilité.',executable:'C:\\fixture.exe',arguments:['{input}'],aliases:['Lecteur'],enabled:true,media:{sourceAppId:'Fixture',deezer:true}};
const config = {version:1,applications:[app,{...app,id:'22222222-2222-4222-8222-222222222222',name:'Désactivée',enabled:false}],language:'fr',autoExecute:false,confidenceThreshold:0.7,commandAliases:[{id:'alias',phrase:'ma recherche',applicationId:app.id,action:'deezer_search',arguments:{query:'Titre de test'}}]};
window.pamFixture = {setState:s=>{scenario=s;},getState:()=>scenario,release:()=>{window.releaseFixture?.();}};
export const isTauri = () => true;
export const listen = async () => () => {};
export const open = async () => null;
export async function invoke(command,input) {
  if(command==='discover_applications') {
    if(scenario==='waiting') await new Promise(resolve=>{window.releaseFixture=resolve;});
    if(scenario==='error') throw Error('Erreur de découverte simulée : veuillez réessayer.');
    return [{name:'Détectée',appId:'Fixture.Detected',kind:'desktop'}];
  }
  if(command!=='assistant_request') return;
  const {method,payload}=input;
  if(method==='status') return {ready:scenario!=='offline',config:scenario==='empty'?{...config,applications:[],commandAliases:[]}:config,configDirectory:'C:\\profil-jetable',manifest:{node:'24',npm:'11'},checks:[{file:'Modèle de test',available:false}],engine:{loaded:true,generation:1,pid:0},...(scenario==='recovery'?{configError:{message:'Profil simulé invalide.',fingerprint:'fixture',recoverable:true}}:{}),...(scenario==='offline'?{desktop:{shortcutError:'Raccourci indisponible'},temporaryCleanup:{failed:1}}:{})};
  if(method==='media_sessions') {
    if(scenario==='error') throw Error('Erreur de session simulée.');
    const session={sourceAppId:'Fixture',title:'Titre simulé',artist:'Artiste',playbackStatus:'Playing',capabilities:{play:true,pause:true,next:true,previous:true,stop:true,toggle:true}};
    return scenario==='offline'?[]:scenario==='ambiguous'?[session,session]:[session];
  }
  if(method==='process_text') {
    if(scenario==='error') throw Error('Erreur de demande simulée.');
    if(scenario==='waiting') await new Promise(resolve=>{window.releaseFixture=resolve;});
    const status=['executed','pending','unsupported','silence','failed','cancelled','partial'].includes(payload.text)?payload.text:'pending';
    return {id:crypto.randomUUID(),transcript:payload.text,status,confidence:0.9,durationMs:12,reasoning:'Détails de la demande simulée.',message:'Résultat simulé explicite.',calls:[{applicationId:app.id,applicationName:app.name,arguments:{input:'Texte de test'}}],results:[{applicationName:app.name,success:status==='executed',message:status==='executed'?'Action réussie.':'Action échouée ou non effectuée.',outcome:status==='executed'?'performed':'failed'}]};
  }
  if(method==='test_application') return {success:scenario!=='error',message:scenario==='error'?'Échec du test simulé.':'Test simulé réussi.'};
  if(method==='recover_config'){scenario='empty';return {config:{...config,applications:[],commandAliases:[]},backupPath:'C:\\profil-jetable\\sauvegarde.json'};}
  if(['save_application','save_command_alias','correct_request'].includes(method)) throw Error('Erreur de formulaire simulée. Corrigez puis réessayez.');
  throw Error('Unexpected fixture method: '+method);
}
