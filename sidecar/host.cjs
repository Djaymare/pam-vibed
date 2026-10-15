const { randomUUID } = require('node:crypto');
const {contract,matches,validReference,validateHostPayload}=require('./contracts.cjs');
const {envelope}=require('./diagnostics.cjs');

// Reverse RPC on the existing private pipe. The sidecar stays supervised;
// only the Rust host starts applications owned by the user.
function createHostChannel(write, { timeout = 12_000 } = {}) {
  const pending = new Map(); let requestId;
  return {
    setContext(id) { requestId=id; },
    request(method, payload, {budget} = {}) {
      if (!validReference(requestId) || !validateHostPayload(method,payload)) return Promise.reject(new Error('Requête native invalide.'));
      try { budget?.check('transport hôte'); } catch(error) { return Promise.reject(error); }
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          const error=new Error('L’hôte de lancement n’a pas répondu. La commande ne sera pas rejouée.');
          error.outcome='unknown';reject(error);
        }, budget ? budget.timeout(timeout) : timeout);
        pending.set(id, { resolve, reject, timer, requestId });
        try { write(JSON.stringify({ version:contract.version,requestId,type: 'host_request', id, method, payload, ...(budget ? {remainingMs:budget.remaining()} : {}) }) + '\n'); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    receive(response) {
      if (response?.type !== 'host_response') return false;
      const request = pending.get(response.id);
      if (request && response.version===contract.version && response.requestId===request.requestId) {
        pending.delete(response.id); clearTimeout(request.timer);
        if (response.ok === true && matches(response.result,'NativeLaunchResult')) request.resolve(response.result);
        else {
          const diagnostic=response.ok===false && matches(response.error,'PamError') && response.error.requestId===request.requestId
            ? response.error : envelope('transport_protocol',request.requestId,'host');
          const error=new Error(diagnostic.message);
          error.diagnostic=diagnostic;
          request.reject(error);
        }
      }
      return true;
    },
    close() {
      for (const request of pending.values()) {
        clearTimeout(request.timer); const error=new Error('L’hôte de lancement a été interrompu.');error.outcome='unknown';request.reject(error);
      }
      pending.clear();
    },
  };
}

function hostLauncher(request) {
  return async (application, args, options = {}) => {
    const argv = application.arguments.map(argument => argument.replaceAll('{input}', args.input ?? ''));
    if(options.beforeEffect)await options.beforeEffect();
    options.budget?.check('lancement hôte');
    const result = await request('launch_application', { ...application, arguments: argv }, options);
    if (result?.accepted !== true) throw new Error('Windows a refusé le lancement.');
    return { applicationName: application.name, success: true, message: `${application.name} lancé.`, details: result };
  };
}

function hostNativeRequest(hostRequest, nativeRequest) {
  return (request, options) => request.method === 'deezer_open'
    ? hostRequest('deezer_open', request, options) : nativeRequest(request, options);
}

module.exports = { createHostChannel, hostLauncher, hostNativeRequest };
