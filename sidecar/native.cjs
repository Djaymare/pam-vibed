const { execFile } = require('node:child_process');

function nativeRequest(request, options = {}, executable = process.env.PAM_NATIVE_EXE, execute = execFile) {
  // Preserve the explicit executable argument used by fixture callers.
  if(typeof options==='string'){executable=options;options={};}
  const {budget,effect=false}=options;
  try { budget?.check('auxiliaire Windows'); } catch(error) { return Promise.reject(error); }
  if (!executable) return Promise.reject(new Error('Le bridge multimédia Windows est indisponible. Ouvrez PAM Windows.'));
  return new Promise((resolve, reject) => {
    const child = execute(executable, ['--pam-native'], {
      windowsHide: true, shell: false, timeout: budget ? budget.timeout(12_000) : 12_000, maxBuffer: 1_000_000, encoding: 'utf8',
    }, (error, stdout) => {
      if (error) {
        const failure = new Error(error.killed ? 'Le lecteur n’a pas répondu dans le délai prévu. La commande ne sera pas rejouée.' : `Bridge Windows indisponible : ${error.message}`);
        if(effect && (error.killed || error.code!=='ENOENT'))failure.outcome='unknown';
        return reject(failure);
      }
      let response;
      try {
        response = JSON.parse(stdout);
        if (response.ok !== true) throw new Error(response.error || 'Réponse native invalide.');
        resolve(response.result);
      } catch (error) { if(effect && response?.ok!==false)error.outcome='unknown';reject(error); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}
module.exports = { nativeRequest };
