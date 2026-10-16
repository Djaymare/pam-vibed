// Frontend-only services: no sidecar, file picker, microphone or launched app.
const config = { version: 2, commandAliases: [], applications: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Fixture', description: 'Application simulée', executable: 'C:\\fixture.exe', arguments: [], aliases: [], enabled: true }], language: 'fr', autoExecute: false, confidenceThreshold: 0.7 };
const availabilityScenario = new URLSearchParams(location.search).has('availability');
const draftScenario = new URLSearchParams(location.search).has('drafts');
const deletionScenario = new URLSearchParams(location.search).has('deletion');
const statusScenario = new URLSearchParams(location.search).has('status');
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
    return { version, id, requestId, method, ok: true, result: await handle(method, payload) };
  } catch (error) {
    return { version, id, requestId, method, ok: false, error: { code: 'invalid_request', stage: 'validation', requestId, retryable: true, technical: { category: 'invalid_request' }, message: error.message } };
  }
}
async function handle(method, payload) {
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
