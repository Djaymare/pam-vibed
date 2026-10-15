const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { atomicJson } = require('./temporary-files.cjs');

const TTL_MS = 10 * 60_000;
const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;
const messages = {
  expired: 'Cette proposition a expiré après dix minutes. Reformulez votre demande.',
  configuration_changed: 'Les applications ou formulations ont changé. Reformulez votre demande.',
  profile_invalid: 'Le profil est invalide. Réparez-le puis reformulez votre demande.',
  corrected: 'Cette proposition a été remplacée par une correction. Reformulez si la correction a échoué.',
  restarted: 'PAM a redémarré. Cette proposition a été retirée ; reformulez votre demande.',
  confirmed: 'Cette confirmation a déjà été consommée. Aucun rejeu autorisé.',
  discarded: 'Cette proposition a été annulée. Reformulez votre demande si nécessaire.',
  unknown_proposal: 'Proposition inconnue. Reformulez votre demande.',
};

function proposalStore(directory, { now = Date.now } = {}) {
  const folder = path.join(directory, 'proposals');
  const session = randomUUID();
  let initialized, tail = Promise.resolve();
  const write = record => atomicJson(path.join(folder, `${record.turn.id}.json`), record, directory);
  const transition = (record, state, reason) => {
    record.turn.proposal = { ...record.turn.proposal, state, reason };
    return record;
  };
  const snapshot = record => ({ id: record.turn.id, ...record.turn.proposal, message: messages[record.turn.proposal.reason] });
  async function safeDirectory(location) {
    try {
      const root = await fs.lstat(directory), stat = await fs.lstat(location);
      return root.isDirectory() && !root.isSymbolicLink() && stat.isDirectory() && !stat.isSymbolicLink() &&
        path.resolve(await fs.realpath(location)).toLowerCase() === path.resolve(await fs.realpath(directory), path.relative(directory, location)).toLowerCase();
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async function read(id) {
    if (!await safeDirectory(folder)) return null;
    try {
      const file = path.join(folder, `${id}.json`), stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
      const record = JSON.parse(await fs.readFile(file, 'utf8'));
      if (record.turn?.id !== id || !record.turn.proposal || !['pending','expired','invalidated','consumed'].includes(record.turn.proposal.state)) throw new Error('Invalid proposal record');
      return record;
    }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function files(location) {
    if (!await safeDirectory(location)) return [];
    try {
      const result = [];
      for (const name of await fs.readdir(location)) {
        if (!UUID_FILE.test(name)) continue;
        const stat = await fs.lstat(path.join(location, name));
        if (stat.isFile() && !stat.isSymbolicLink()) result.push(name);
      }
      return result;
    }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  function initialize() {
    return initialized ||= (async () => {
      // Retain a business-state tombstone before the legacy collector can remove
      // an approval. Startup never restores execution permission.
      const legacy = path.join(directory, 'pending');
      for (const name of await files(legacy)) {
        const old = JSON.parse(await fs.readFile(path.join(legacy, name), 'utf8'));
        if (old.turn?.id !== name.slice(0, -5) || !Number.isFinite(old.createdAt)) continue;
        if (!await read(old.turn.id)) {
          old.version = 1;
          old.turn.proposal = { state: 'pending', createdAt: old.createdAt, expiresAt: old.createdAt + TTL_MS, reason: null };
          await write(transition(old, now() >= old.turn.proposal.expiresAt ? 'expired' : 'invalidated', now() >= old.turn.proposal.expiresAt ? 'expired' : 'restarted'));
        }
        await fs.unlink(path.join(legacy, name));
      }
      for (const name of await files(folder)) {
        const record = await read(name.slice(0, -5));
        if (record.turn.proposal.state === 'pending') {
          const expired = now() >= record.turn.proposal.expiresAt;
          await write(transition(record, expired ? 'expired' : 'invalidated', expired ? 'expired' : 'restarted'));
        }
      }
    })();
  }
  function serial(operation) {
    const result = tail.then(async () => { await initialize(); return operation(); });
    tail = result.catch(() => {});
    return result;
  }
  async function revalidate(record, digest) {
    if (record?.turn.proposal.state !== 'pending') return record;
    const expired = now() >= record.turn.proposal.expiresAt;
    const reason = expired ? 'expired' : digest === null ? 'profile_invalid' : record.configDigest !== digest ? 'configuration_changed' : null;
    if (reason) await write(transition(record, expired ? 'expired' : 'invalidated', reason));
    return record;
  }
  return {
    initialize,
    prepare(turn, digest) { return serial(async () => {
      const createdAt = now();
      turn.proposal = { state: 'pending', createdAt, expiresAt: createdAt + TTL_MS, reason: null };
      await write({ version: 1, session, configDigest: digest, turn });
      return turn;
    }); },
    reconcile(digest) { return serial(async () => {
      const states = [];
      for (const name of await files(folder)) states.push(snapshot(await revalidate(await read(name.slice(0, -5)), digest)));
      return states;
    }); },
    invalidate(id, reason = 'corrected') { return serial(async () => {
      const record = await read(id);
      if (record?.turn.proposal.state === 'pending') await write(transition(record, 'invalidated', reason));
    }); },
    claim(id, digest, accept) { return serial(async () => {
      const record = await revalidate(await read(id), digest);
      if (!record) return { executable: false, turn: { id, transcript: '', language: 'fr', confidence: null, reasoning: '', durationMs: 0, calls: [], results: [],
        status: 'invalidated', proposal: { state: 'unknown', reason: 'unknown_proposal', createdAt: null, expiresAt: null }, message: messages.unknown_proposal } };
      if (record.turn.proposal.state !== 'pending') return { executable: false,
        turn: { ...record.turn, status: record.turn.proposal.state, message: messages[record.turn.proposal.reason] } };
      // Persist consumption before any effect; a crash cannot revive permission.
      await write(transition(record, 'consumed', accept ? 'confirmed' : 'discarded'));
      return { executable: accept, turn: { ...record.turn, status: accept ? 'consumed' : 'cancelled', message: messages[record.turn.proposal.reason] } };
    }); },
  };
}
module.exports = { proposalStore, TTL_MS };
