const { execFile } = require('node:child_process');

function nativeRequest(request, executable = process.env.PAM_NATIVE_EXE) {
  if (!executable) return Promise.reject(new Error('Le bridge multimédia Windows est indisponible. Ouvrez PAM Windows.'));
  return new Promise((resolve, reject) => {
    const child = execFile(executable, ['--pam-native'], {
      windowsHide: true, shell: false, timeout: 12_000, maxBuffer: 1_000_000, encoding: 'utf8',
    }, (error, stdout) => {
      if (error) return reject(new Error(error.killed ? 'Le lecteur n’a pas répondu dans le délai prévu. La commande ne sera pas rejouée.' : `Bridge Windows indisponible : ${error.message}`));
      try {
        const response = JSON.parse(stdout);
        if (response.ok !== true) throw new Error(response.error || 'Réponse native invalide.');
        resolve(response.result);
      } catch (error) { reject(error); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}
module.exports = { nativeRequest };
