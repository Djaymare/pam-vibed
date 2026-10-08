import { cp, copyFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(process.argv[2] || join(root, 'artifacts/PAM-windows-x64'));
const candidates = [
  'src-tauri/target/x86_64-pc-windows-msvc/release/pam.exe',
  'src-tauri/target/release/pam.exe',
];
let executable;
for (const candidate of candidates) {
  try { await stat(join(root, candidate)); executable = join(root, candidate); break; } catch {}
}
if (!executable) throw new Error('Compiler PAM pour Windows x64 avec tauri build avant de créer le dossier portable. Une compilation cargo seule doit activer --features custom-protocol.');
await mkdir(destination, { recursive: true });
try { await copyFile(executable, join(destination, 'PAM.exe')); }
catch (error) {
  if (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EBUSY') {
    throw new Error('Fermez la version portable de PAM avant de recréer son dossier (Windows verrouille un exécutable en cours d’utilisation).');
  }
  throw error;
}
await copyFile(join(root, 'src-tauri/binaries/pam-node-x86_64-pc-windows-msvc.exe'), join(destination, 'pam-node.exe'));
await cp(join(root, 'src-tauri/runtime'), join(destination, 'runtime'), { recursive: true });
await cp(join(root, 'sidecar'), join(destination, 'sidecar'), { recursive: true, filter: path => !path.endsWith('.test.cjs') });
await copyFile(join(root, 'README.md'), join(destination, 'README.md'));
console.log(`Application portable : ${destination}. Le runtime WebView2 de Windows doit être présent ; l’installeur NSIS l’embarque.`);
