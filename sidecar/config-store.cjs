const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { validateConfig, DEFAULT_CONFIG, MAX_CONFIG_BYTES } = require('./config-schema.cjs');
const { atomicJson } = require('./temporary-files.cjs');

async function snapshot(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Le profil doit être un fichier ordinaire.');
  const handle = await fs.open(file, 'r');
  try {
    const before = await handle.stat();
    const bytes = Buffer.alloc(Math.min(before.size, MAX_CONFIG_BYTES + 1));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || offset !== bytes.length) throw new Error('Le profil a changé pendant sa lecture. Réessayez.');
    const content = bytes.subarray(0, offset);
    const fingerprint = createHash('sha256').update(content).update(`${after.size}:${after.mtimeMs}`).digest('hex');
    return { bytes: content, size: after.size, fingerprint };
  } finally { await handle.close(); }
}
function parseProfile(source) {
  if (source.size > MAX_CONFIG_BYTES) throw new Error('Profil trop volumineux (2 Mio maximum).');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes); }
  catch { throw new Error('Le fichier doit être encodé en UTF-8 valide.'); }
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error('Le fichier ne contient pas un JSON valide.'); }
  return validateConfig(value);
}
function profileError(message, source) {
  const error = new Error(`Profil invalide : ${message} Le fichier original est conservé. Restaurez une copie correcte ou utilisez la récupération après sauvegarde.`);
  error.code = 'invalid_profile';
  error.details = { message: error.message, ...(source ? { fingerprint: source.fingerprint } : {}), recoverable: !!source };
  return error;
}
async function readConfig(directory) {
  let source;
  try { source = await snapshot(path.join(directory, 'applications.json')); }
  catch (error) {
    if (error.code === 'ENOENT') return structuredClone(DEFAULT_CONFIG);
    throw profileError(error.message);
  }
  try { return parseProfile(source); }
  catch (error) { throw profileError(error.message, source); }
}

// Recovery is deliberately minimal: keep an exact, exclusive backup and replace
// the broken profile with an empty version-1 profile only on explicit approval.
async function recoverConfig(directory, payload, { budget } = {}) {
  if (payload?.confirmed !== true || typeof payload.fingerprint !== 'string') throw new Error('Confirmez explicitement la sauvegarde et la restauration du profil vide.');
  const file = path.join(directory, 'applications.json');
  const source = await snapshot(file);
  if (source.fingerprint !== payload.fingerprint) throw new Error('Le profil a changé. Relisez son état avant de le récupérer.');
  try { parseProfile(source); }
  catch {
    const backupPath = path.join(directory, `applications.invalid.${Date.now()}.${randomUUID()}.json`);
    budget?.check('avant sauvegarde du profil');
    await fs.copyFile(file, backupPath, constants.COPYFILE_EXCL);
    const backup = await snapshot(backupPath);
    if (backup.size !== source.size || !backup.bytes.equals(source.bytes) || (await snapshot(file)).fingerprint !== source.fingerprint) {
      throw new Error(`Le profil a changé pendant la sauvegarde. Aucun remplacement ; copie conservée : ${backupPath}`);
    }
    budget?.check('avant restauration du profil');
    const config = validateConfig(structuredClone(DEFAULT_CONFIG));
    await atomicJson(file, config, directory);
    return { config, backupPath };
  }
  throw new Error('Ce profil est valide ; aucune récupération nécessaire.');
}
module.exports = { readConfig, recoverConfig };
