// Frontend-only services: no sidecar, file picker, microphone or launched app.
const config = { version: 1, applications: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Fixture', description: 'Application simulée', executable: 'C:\\fixture.exe', arguments: [], aliases: [], enabled: true }], language: 'fr', autoExecute: false, confidenceThreshold: 0.7 };
const availabilityScenario = new URLSearchParams(location.search).has('availability');
let available = !availabilityScenario;
if (availabilityScenario) {
  config.applications[0].aliases = ['Mon test'];
  config.applications[0].arguments = ['--keep'];
  config.commandAliases = [{ id:'alias-fixture', phrase:'Ouvre mon test', applicationId:config.applications[0].id, action:'open' }];
  window.pamAvailabilityFixture = { config, calls:[] };
}
let saveAttempts = 0, correctionAttempts = 0;
const turn = (id, text) => ({ id, transcript: text, status: 'pending', confidence: 0.9, durationMs: 1, calls: [], results: [] });
export const isTauri = () => true;
export const listen = async () => () => {};
export const open = async () => availabilityScenario ? 'C:\\repaired.exe' : null;
export async function invoke(command, input) {
  if (command === 'discover_applications') return [{ name: 'Détectée', appId: 'Fixture.Detected', kind: 'desktop' }];
  if (command !== 'assistant_request') return;
  const { method, payload } = input;
  if (availabilityScenario) window.pamAvailabilityFixture.calls.push({method,payload});
  if (method === 'status') return { config, ready: true, checks: [], engine: null,
    ...(availabilityScenario ? {applicationAvailability:{[config.applications[0].id]:{available,reason:'Cible de test indisponible.'}}} : {}) };
  if (method === 'media_sessions') return [];
  if (method === 'set_application_enabled') {
    if (payload.enabled && !available) throw Error('Réparez la cible avant réactivation.');
    config.applications.find(a=>a.id===payload.id).enabled = payload.enabled;
    return config;
  }
  if (method === 'save_application') {
    if (!availabilityScenario && ++saveAttempts === 1) throw Error('Enregistrement simulé refusé. Corrigez puis réessayez.');
    if (availabilityScenario) available = payload.executable === 'C:\\repaired.exe' || !!payload.windowsApp;
    const app = { ...payload, id: payload.id || '22222222-2222-4222-8222-222222222222' };
    config.applications = [...config.applications.filter(a => a.id !== app.id), app];
    return config;
  }
  if (method === 'process_text') return turn('original', payload.text);
  if (method === 'correct_request') {
    if (++correctionAttempts === 1) throw Error('Correction simulée refusée. Réessayez.');
    return turn('corrected', payload.text);
  }
  throw Error(`Unexpected fixture method: ${method}`);
}
