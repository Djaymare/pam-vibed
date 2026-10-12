const { randomUUID } = require('node:crypto');

// Reverse RPC on the existing private pipe. The sidecar stays supervised;
// only the Rust host starts applications owned by the user.
function createHostChannel(write, { timeout = 12_000 } = {}) {
  const pending = new Map();
  return {
    request(method, payload) {
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('L’hôte de lancement n’a pas répondu. La commande ne sera pas rejouée.'));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        try { write(JSON.stringify({ type: 'host_request', id, method, payload }) + '\n'); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    receive(response) {
      if (response?.type !== 'host_response') return false;
      const request = pending.get(response.id);
      if (request) {
        pending.delete(response.id); clearTimeout(request.timer);
        if (response.ok === true) request.resolve(response.result);
        else request.reject(new Error(response.error || 'Le lancement a échoué.'));
      }
      return true;
    },
    close() {
      for (const request of pending.values()) {
        clearTimeout(request.timer); request.reject(new Error('L’hôte de lancement a été interrompu.'));
      }
      pending.clear();
    },
  };
}

function hostLauncher(request) {
  return async (application, args) => {
    const argv = application.arguments.map(argument => argument.replaceAll('{input}', args.input ?? ''));
    const result = await request('launch_application', { ...application, arguments: argv });
    if (result?.accepted !== true) throw new Error('Windows a refusé le lancement.');
    return { applicationName: application.name, success: true, message: `${application.name} lancé.`, details: result };
  };
}

function hostNativeRequest(hostRequest, nativeRequest) {
  return request => request.method === 'deezer_open'
    ? hostRequest('deezer_open', request) : nativeRequest(request);
}

module.exports = { createHostChannel, hostLauncher, hostNativeRequest };
