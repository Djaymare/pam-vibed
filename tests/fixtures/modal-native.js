// Frontend-only services: no sidecar, file picker, microphone or launched app.
const config = { version: 2, commandAliases: [], applications: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Fixture', description: 'Application simulée', executable: 'C:\\fixture.exe', arguments: [], aliases: [], enabled: true }], language: 'fr', autoExecute: false, confidenceThreshold: 0.7 };
const availabilityScenario = new URLSearchParams(location.search).has('availability');
const draftScenario = new URLSearchParams(location.search).has('drafts');
const deletionScenario = new URLSearchParams(location.search).has('deletion');
const statusScenario = new URLSearchParams(location.search).has('status');
const proposalScenario = new URLSearchParams(location.search).has('proposals');
const firstUseScenario = new URLSearchParams(location.search).has('first-use');
const journeyScenario = new URLSearchParams(location.search).has('journeys');
if(journeyScenario) window.pamJourneyFixture={calls:[],mode:'success',hold:false,release:()=>{}};
if (firstUseScenario) {
  Object.assign(config, JSON.parse(localStorage.getItem('pam-first-use-config') || 'null') || {applications:[]});
  window.pamFirstUseFixture = {config,calls:[],available:true,shortcut:localStorage.getItem('pam-first-use-shortcut') || 'ctrl_shift_space'};
  const originalCapture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  window.pamFirstUseFixture.tracks=[];
  navigator.mediaDevices.getUserMedia=async options=>{const stream=await originalCapture(options);window.pamFirstUseFixture.tracks.push(...stream.getTracks());return stream;};
}
if (proposalScenario) {
  const app=config.applications[0];app.name='Deezer Fixture';app.media={sourceAppId:'Deezer.exe',deezer:true};app.windowsApp={appId:'Deezer.62021768415AF_q7m17pa7q8kj0!Deezer.Music',kind:'store',icon:null};
  window.pamProposalFixture={config,calls:[],mode:'complete',sequence:0};
}
if (statusScenario) window.pamStatusFixture = { config, calls: [], phase:'starting', activity:'idle', hold:false, fail:false, release:()=>{} };
if (deletionScenario) {
  config.applications[0].aliases = ['Mon éditeur'];
  config.applications.push({...config.applications[0], id:'22222222-2222-4222-8222-222222222222',name:'Autre',aliases:[]});
  config.commandAliases = [
    {id:'55555555-5555-4555-8555-555555555555',phrase:'Ouvre mon premier',applicationId:config.applications[0].id,action:'open'},
    {id:'66666666-6666-4666-8666-666666666666',phrase:'Mon autre formulation',applicationId:config.applications[0].id,action:'open'},
    {id:'77777777-7777-4777-8777-777777777777',phrase:'Ouvre mon autre',applicationId:config.applications[1].id,action:'open'},
  ];
  window.pamDeletionFixture = { config, calls:[], fail:false, hold:false, release:()=>{} };
}
if (draftScenario) window.pamDraftFixture = { config, calls: [], failSettings: true, failAlias: true };
let available = !availabilityScenario;
if (availabilityScenario) {
  config.applications[0].aliases = ['Mon test'];
  config.applications[0].arguments = ['--keep'];
  config.commandAliases = [{ id:'alias-fixture', phrase:'Ouvre mon test', applicationId:config.applications[0].id, action:'open' }];
  window.pamAvailabilityFixture = { config, calls:[] };
}
let saveAttempts = 0, correctionAttempts = 0;
const turn = (id, text) => ({ id, transcript: text, language: 'fr', reasoning: '', status: 'pending', confidence: 0.9, durationMs: 1, calls: [], results: [] });
export const isTauri = () => true;
export const listen = async () => () => {};
export const open = async () => availabilityScenario ? 'C:\\repaired.exe' : null;
export async function invoke(command, input) {
  if (command !== 'assistant_request') return;
  const { version, id, requestId, method, payload } = input.request;
  try {
    return { version, id, requestId, method, ok: true, result: JSON.parse(JSON.stringify(await handle(method, JSON.parse(JSON.stringify(payload))))) };
  } catch (error) {
    return { version, id, requestId, method, ok: false, error: { code: error.code||'invalid_request', stage: 'validation', requestId, retryable: true, technical: { category: error.code||'invalid_request' }, message: error.message } };
  }
}
async function handle(method, payload) {
  if(journeyScenario) {
    const f=window.pamJourneyFixture;f.calls.push({method,payload});
    if(method==='process_text') {
      if(f.hold) await new Promise(resolve=>{f.release=resolve;});
      if(f.mode==='timeout')throw Object.assign(Error('Délai de fixture dépassé.'),{code:'request_timeout'});
      return {...turn(crypto.randomUUID(),payload.text),proposal:{state:'pending',createdAt:Date.now(),expiresAt:Date.now()+600000,reason:null}};
    }
  }
  if (method === 'voice_shortcut') {
    const f=window.pamFirstUseFixture;
    if(!f)return {id:'ctrl_shift_space',label:'Ctrl + Maj + Espace',available:true,error:''};
    f.calls.push({method,payload});
    if(payload.shortcut){f.shortcut=payload.shortcut;localStorage.setItem('pam-first-use-shortcut',f.shortcut);}
    return {id:f.shortcut,label:f.shortcut==='ctrl_alt_space'?'Ctrl + Alt + Espace':'Ctrl + Maj + Espace',available:f.shortcut!=='ctrl_shift_space',error:f.shortcut==='ctrl_shift_space'?'Ce raccourci est occupé. Choisissez une autre combinaison.':''};
  }
  if (firstUseScenario) {
    const f=window.pamFirstUseFixture;f.calls.push({method,payload});
    const save=()=>{localStorage.setItem('pam-first-use-config',JSON.stringify(config));return config;};
    if(method==='status')return {config,ready:true,checks:[],manifest:null,configDirectory:'Disposable profile',engine:null,applicationAvailability:Object.fromEntries(config.applications.map(a=>[a.id,{available:f.available,reason:'Application de test absente.'}]))};
    if(method==='save_application'){const app={...payload,id:payload.id||'22222222-2222-4222-8222-222222222222'};if(app.windowsApp)app.executable='C:\\fixture.exe';config.applications=[...config.applications.filter(a=>a.id!==app.id),app];return save();}
    if(method==='set_application_enabled'){config.applications.find(a=>a.id===payload.id).enabled=payload.enabled;return save();}
    if(method==='test_application')return {applicationName:payload.name,success:f.available,outcome:f.available?'performed':'failed',message:f.available?'Ouverture de test demandée.':'Application absente.'};
    const app=config.applications[0];
    const call={name:'open_fixture',applicationId:app?.id,applicationName:app?.name,action:'open',actionLabel:'Ouvrir',arguments:{}};
    if(method==='process_text')return {...turn('33333333-3333-4333-8333-333333333333',payload.text),calls:[call]};
    if(method==='confirm')return {...turn(payload.id,'Ouvre Détectée'),status:'executed',calls:[call],results:[{applicationName:app.name,success:true,outcome:'performed',message:'Action simulée effectuée.'}]};
  }
  if(proposalScenario) {
    const f=window.pamProposalFixture;f.calls.push({method,payload});
    const call={name:'fixture_flow',applicationId:config.applications[0].id,applicationName:'Deezer Fixture',action:'deezer_start',actionLabel:'Démarrer Flow',arguments:{mix:'flow'}};
    if(method==='prepare_action')return {...turn('proposal-'+(++f.sequence),'Flow Fixture'),calls:[call],proposal:{state:'pending',createdAt:Date.now(),expiresAt:Date.now()+(f.mode==='expired'?1000:600000),reason:null}};
    if(method==='confirm')return {...turn(payload.id,'Flow Fixture'),status:f.mode==='complete'?'executed':'partial',calls:f.mode==='partial'?[call,call,call]:[call],results:f.mode==='complete'?[{applicationName:'Deezer Fixture',success:true,outcome:'performed',message:'Lecture demandée à Deezer. Le protocole ne fournit pas de confirmation de lecture.',details:{accepted:true}}]:f.mode==='partial'?[{index:0,applicationName:'Deezer Fixture',success:true,outcome:'performed',message:'Commande acceptée.',details:{accepted:true}},{index:1,applicationName:'Deezer Fixture',success:false,outcome:'unknown',message:'Réponse perdue.'},{index:2,applicationName:'Deezer Fixture',success:false,outcome:'not_started',message:'Action non démarrée.'}]:[{applicationName:'Deezer Fixture',success:false,outcome:'unknown',message:'Réponse perdue.'}]};
    if(method==='discard')return {...turn(payload.id,'Flow Fixture'),status:'cancelled'};
  }
  if (method === 'supervisor_status') return statusScenario ? {phase:window.pamStatusFixture.phase,activity:window.pamStatusFixture.activity} : {phase:'ready',activity:'idle'};
  if (method === 'desktop_action') return null;
  if (method === 'discover_applications') return [{ name: 'Détectée', appId: 'Fixture.Detected', kind: 'desktop', icon: null }];
  if (availabilityScenario) window.pamAvailabilityFixture.calls.push({method,payload});
  if (draftScenario) window.pamDraftFixture.calls.push({method,payload});
  if (deletionScenario) window.pamDeletionFixture.calls.push({method,payload});
  if (statusScenario) {
    const f=window.pamStatusFixture;
    f.calls.push({method,payload});
    if (['process_text','confirm','discard','settings'].includes(method)) {
      if(f.hold) await new Promise(resolve=>{f.release=resolve;});
      if(f.fail) throw Error('Erreur de test récupérable. Vérifiez puis réessayez.');
      if(method==='settings') {Object.assign(config,payload);return config;}
      if(method==='process_text') return {...turn('33333333-3333-4333-8333-333333333333',payload.text),calls:[{name:'open_fixture',applicationId:config.applications[0].id,applicationName:'Fixture',action:'open',actionLabel:'Ouvrir',arguments:{}}]};
      return {...turn(payload.id,'Demande de test'),status:method==='confirm'?'executed':'cancelled',calls:[],results:method==='confirm'?[{applicationId:config.applications[0].id,applicationName:'Fixture',message:'Action de test effectuée.',success:true,outcome:'performed'}]:[]};
    }
  }
  if (deletionScenario && method.startsWith('delete_')) {
    const f=window.pamDeletionFixture;
    if(f.hold) await new Promise(resolve=>{f.release=resolve;});
    if(f.fail) throw Error('Écriture de test refusée.');
    if(method==='delete_application') {
      config.applications=config.applications.filter(a=>a.id!==payload.id);
      config.commandAliases=config.commandAliases.filter(a=>a.applicationId!==payload.id);
    } else config.commandAliases=config.commandAliases.filter(a=>a.id!==payload.id);
    return config;
  }
  if (method === 'status') return { config, ready: true, checks: [], manifest: null, configDirectory: 'C:\\fixture-profile', engine: null,
    ...(availabilityScenario ? {applicationAvailability:{[config.applications[0].id]:{available,reason:'Cible de test indisponible.'}}} : {}) };
  if (method === 'media_sessions') return [];
  if (method === 'set_application_enabled') {
    if (payload.enabled && !available) throw Error('Réparez la cible avant réactivation.');
    config.applications.find(a=>a.id===payload.id).enabled = payload.enabled;
    return config;
  }
  if (method === 'save_application') {
    if (!availabilityScenario && !draftScenario && ++saveAttempts === 1) throw Error('Enregistrement simulé refusé. Corrigez puis réessayez.');
    if (availabilityScenario) available = payload.executable === 'C:\\repaired.exe' || !!payload.windowsApp;
    const app = { ...payload, id: payload.id || '22222222-2222-4222-8222-222222222222' };
    // Native launch resolution fills the executable for catalogue entries.
    if (app.windowsApp) app.executable = 'C:\\fixture-catalogue.exe';
    config.applications = [...config.applications.filter(a => a.id !== app.id), app];
    return config;
  }
  if (method === 'process_text') return turn('33333333-3333-4333-8333-333333333333', payload.text);
  if (draftScenario && method === 'settings') {
    if(window.pamDraftFixture.failSettings) throw Error('Sauvegarde des préférences refusée.');
    Object.assign(config,payload);return config;
  }
  if (draftScenario && method === 'save_command_alias') {
    if(window.pamDraftFixture.failAlias) throw Error('Sauvegarde de formulation refusée.');
    config.commandAliases=[{...payload,id:'55555555-5555-4555-8555-555555555555'}];return config;
  }
  if (method === 'correct_request') {
    if(draftScenario && payload.saveAlias) config.applications.find(app=>app.id===payload.applicationId).aliases.push(payload.alias);
    if (++correctionAttempts === 1) throw Error('Correction simulée refusée. Réessayez.');
    return turn('44444444-4444-4444-8444-444444444444', payload.text);
  }
  throw Error(`Unexpected fixture method: ${method}`);
}
