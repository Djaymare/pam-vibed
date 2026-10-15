const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DEFAULT_CONFIG, MAX_CONFIG_BYTES } = require('./config-schema.cjs');
const { migrateConfig } = require('./config-migrations.cjs');

const SESSION = randomUUID();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = config => Buffer.from(JSON.stringify(config, null, 2));
const summary = config => ({ applications: config.applications.map(app => app.name), formulations: config.commandAliases.length,
  language: config.language, autoExecute: config.autoExecute, confidenceThreshold: config.confidenceThreshold });

function createConfigStore(directory, { io = fs, migrations, checkpoint = async () => {} } = {}) {
  directory = path.resolve(directory);
  const file = path.join(directory, 'applications.json'), backupFile = path.join(directory, 'applications.backup.json');
  async function safeRoot(create = false) {
    if (create) await io.mkdir(directory, { recursive: true });
    const stat = await io.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Le dossier du profil doit être ordinaire.');
    return io.realpath(directory);
  }
  async function ordinary(target, optional = false) {
    try {
      const stat = await io.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Le profil doit être un fichier ordinaire.');
    } catch (error) { if (!optional || error.code !== 'ENOENT') throw error; }
  }
  async function snapshot(target = file) {
    await safeRoot(); await ordinary(target);
    const handle = await io.open(target, 'r');
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
      return { bytes: content, size: after.size, fingerprint: digest(Buffer.concat([content, Buffer.from(`${after.size}:${after.mtimeMs}`)])) };
    } finally { await handle.close(); }
  }
  async function current() {
    try { return await snapshot(); }
    catch (error) { if (error.code === 'ENOENT') return { fingerprint: 'missing', missing: true }; throw error; }
  }
  function parse(source) {
    if (source.size > MAX_CONFIG_BYTES) throw new Error('Profil trop volumineux (2 Mio maximum).');
    let text, value;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes); }
    catch { throw new Error('Le fichier doit être encodé en UTF-8 valide.'); }
    try { value = JSON.parse(text); }
    catch { throw new Error('Le fichier ne contient pas un JSON valide.'); }
    return migrateConfig(value, migrations);
  }
  async function backup() {
    try { const source = await snapshot(backupFile); return { source, config: parse(source) }; }
    catch { return null; }
  }
  async function profileError(message, source) {
    const saved = await backup();
    const error = new Error(`Profil invalide : ${message} Le fichier original est conservé. Restaurez la dernière sauvegarde valide, importez un export correct ou utilisez la récupération après sauvegarde.`);
    error.code = 'invalid_profile';
    error.details = { message: error.message, ...(source ? { fingerprint: source.fingerprint } : {}), recoverable: !!source,
      ...(saved ? { backupFingerprint: saved.source.fingerprint, backupSummary: summary(saved.config) } : {}) };
    return error;
  }
  async function readState() {
    let source;
    try {
      source = await current();
      if (source.missing) {
        let exists = false;
        try { await io.lstat(backupFile); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (exists) throw new Error('Profil courant absent ; vérifiez ou restaurez la sauvegarde disponible.');
        return { config: structuredClone(DEFAULT_CONFIG), fingerprint: source.fingerprint };
      }
      return { config: parse(source), fingerprint: source.fingerprint };
    } catch (error) { throw await profileError(error.message, source); }
  }
  async function read() { return (await readState()).config; }
  async function unchanged(expected) {
    if ((await current()).fingerprint !== expected) throw new Error('Le profil a changé. Relisez son état avant de le remplacer.');
  }
  // Do not unlink destinations on Windows sharing violations. Failed renames
  // leave the old file intact. The separate backup is synced before replacement.
  async function replace(target, bytes) {
    const root = await safeRoot(true);
    await ordinary(target, true);
    const temporary = `${target}.${process.pid}.${SESSION}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await io.open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      await checkpoint('temporary_synced', { target, temporary });
      if (await safeRoot() !== root) throw new Error('Le dossier du profil a changé.');
      await ordinary(target, true);
      await io.rename(temporary, target);
      await checkpoint('replaced', { target });
    } finally {
      if (handle) await handle.close();
      try { await io.unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  async function preserve(source) {
    if (source.missing) return null;
    const evidence = path.join(directory, `applications.invalid.${Date.now()}.${randomUUID()}.json`);
    await io.copyFile(file, evidence, constants.COPYFILE_EXCL);
    const handle = await io.open(evidence, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    const copied = await snapshot(evidence);
    if (copied.size !== source.size || !copied.bytes.equals(source.bytes)) throw new Error('Copie de sauvegarde différente ; aucun remplacement.');
    await unchanged(source.fingerprint);
    return evidence;
  }
  async function write(value, { expectedFingerprint, preserveOriginal = false, keepBackup = false, budget, beforeReplace } = {}) {
    const config = migrateConfig(value, migrations), source = await current();
    if (expectedFingerprint !== undefined && source.fingerprint !== expectedFingerprint) throw new Error('Le profil a changé. Relisez son état avant de le remplacer.');
    budget?.check('avant sauvegarde du profil');
    let previous;
    if (!source.missing) { try { previous = parse(source); } catch (error) { if (!preserveOriginal) throw error; } }
    const evidencePath = preserveOriginal ? await preserve(source) : null;
    if (!keepBackup) {
      if (previous) await replace(backupFile, source.bytes);
      else if (!(await backup())) await replace(backupFile, encode(config));
    }
    await checkpoint('backup_ready', { file, backupFile });
    await unchanged(source.fingerprint);
    budget?.check('avant remplacement du profil');
    await beforeReplace?.();
    await unchanged(source.fingerprint);
    budget?.check('remplacement du profil');
    await replace(file, encode(config));
    const verified = parse(await snapshot());
    if (JSON.stringify(verified) !== JSON.stringify(config)) throw new Error('Vérification du profil échouée. Restaurez la sauvegarde.');
    return { config, backupPath: evidencePath ?? backupFile };
  }
  function importValue(content) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_CONFIG_BYTES) throw new Error('Import invalide (JSON UTF-8, 2 Mio maximum).');
    return parse({ bytes: Buffer.from(content), size: Buffer.byteLength(content) });
  }
  async function previewImport(content) {
    const config = importValue(content), source = await current();
    return { fingerprint: source.fingerprint, importFingerprint: digest(content), summary: summary(config) };
  }
  async function importConfig(payload, options) {
    if (payload?.confirmed !== true) throw new Error('Confirmez explicitement le remplacement du profil après aperçu.');
    const preview = await previewImport(payload.content);
    if (payload.fingerprint !== preview.fingerprint || payload.importFingerprint !== preview.importFingerprint) throw new Error('L’import ou le profil a changé. Recommencez l’aperçu.');
    return write(importValue(payload.content), { ...options, expectedFingerprint: preview.fingerprint, preserveOriginal: true });
  }
  async function recover(payload, options = {}) {
    if (payload?.confirmed !== true || typeof payload.fingerprint !== 'string') throw new Error('Confirmez explicitement la sauvegarde et la restauration du profil.');
    const source = await current();
    await unchanged(payload.fingerprint);
    if (payload.restoreBackup === true) {
      const saved = await backup();
      if (!saved || saved.source.fingerprint !== payload.backupFingerprint) throw new Error('La sauvegarde a changé ou est invalide. Relisez son état.');
      return write(saved.config, { ...options, expectedFingerprint: source.fingerprint, preserveOriginal: true, keepBackup: true });
    }
    if (!source.missing) {
      let valid = false; try { parse(source); valid = true; } catch {}
      if (valid) throw new Error('Ce profil est valide ; aucune récupération nécessaire.');
    }
    return write(structuredClone(DEFAULT_CONFIG), { ...options, expectedFingerprint: source.fingerprint, preserveOriginal: true, keepBackup: !!(await backup()) });
  }
  return { read, readState, write, recover, previewImport, importConfig,
    async recoveryInfo() {
      const saved = await backup();
      if (!saved) return null;
      const source = await current();
      return { fingerprint: source.fingerprint, backupFingerprint: saved.source.fingerprint, backupSummary: summary(saved.config) };
    },
    async exportConfig() { return JSON.stringify(await read(), null, 2); } };
}
const readConfig = directory => createConfigStore(directory).read();
const recoverConfig = (directory, payload, options) => createConfigStore(directory).recover(payload, options);
module.exports = { createConfigStore, readConfig, recoverConfig };
