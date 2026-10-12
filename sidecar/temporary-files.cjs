const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// A dead identified owner is collected on the next startup/request. Unmarked
// files from older PAM versions get a ten-minute grace period.
const LEGACY_RETENTION_MS = 10 * 60_000;
const SESSION = randomUUID();
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TURN = new RegExp(`^turn-(\\d+)-(${UUID})-[A-Za-z0-9]{6}$`);
const LEGACY_TURN = /^turn-[A-Za-z0-9]{6}$/;
const TEMP = new RegExp(`^(.+\\.json)\\.(\\d+)\\.(${UUID})\\.(${UUID})\\.tmp$`);
const LEGACY_TEMP = new RegExp(`^(.+\\.json)\\.(${UUID})\\.tmp$`);
const PENDING = new RegExp(`^${UUID}\\.json$`);
const TURN_FILES = new Set(['clip.wav', 'keywords.txt', 'tools.json', 'system.txt', '.pam-owner.json']);
const activeTurns = new Set();
const activeWrites = new Set();

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}
async function rootAt(directory) {
  const absolute = path.resolve(directory);
  const stat = await fs.lstat(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Profil temporaire non sûr.');
  return { absolute, real: await fs.realpath(absolute) };
}
async function checkedDirectory(root, directory) {
  if (!samePath(await fs.realpath(root.absolute), root.real)) throw new Error('Le profil a changé.');
  const relative = path.relative(root.absolute, directory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Chemin hors du profil.');
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      !samePath(await fs.realpath(directory), path.join(root.real, relative))) throw new Error('Dossier temporaire non sûr.');
  return stat;
}
async function unlinkFile(root, directory, name) {
  await checkedDirectory(root, directory);
  const file = path.join(directory, name);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Fichier temporaire non sûr.');
  // Unlink never follows a final symlink; no recursive deletion or traversal.
  await checkedDirectory(root, directory);
  await fs.unlink(file);
}
async function removeTurn(root, directory) {
  await checkedDirectory(root, directory);
  const names = await fs.readdir(directory);
  // Keep ownership until the payload files have all been removed, so an
  // interrupted collection remains identifiable on the next startup.
  for (const name of names.sort((a, b) => Number(a === '.pam-owner.json') - Number(b === '.pam-owner.json'))) {
    if (!TURN_FILES.has(name)) continue;
    try { await unlinkFile(root, directory, name); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await checkedDirectory(root, directory);
  // Unknown files and subdirectories are preserved.
  try { await fs.rmdir(directory); }
  catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
}

function createTemporaryFiles(directory) {
  const absolute = path.resolve(directory);
  return {
    async collect() {
      const report = { removed: 0, failed: 0, retained: 0 };
      let root;
      try { root = await rootAt(absolute); }
      catch (error) { if (error.code !== 'ENOENT') report.failed++; return report; }
      const attempt = async operation => {
        try { await operation(); }
        catch (error) { if (error.code !== 'ENOENT') report.failed++; }
      };
      await attempt(async () => {
        await checkedDirectory(root, absolute);
        for (const name of await fs.readdir(absolute)) {
          const match = TURN.exec(name);
          if (!match && !LEGACY_TURN.test(name)) continue;
          await attempt(async () => {
            const turn = path.join(absolute, name);
            const stat = await checkedDirectory(root, turn);
            if (activeTurns.has(turn)) { report.retained++; return; }
            if (match) {
              let owner;
              try {
                const marker = path.join(turn, '.pam-owner.json');
                const markerStat = await fs.lstat(marker);
                if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.size > 2048) throw new Error('Propriétaire invalide.');
                owner = JSON.parse(await fs.readFile(marker, 'utf8'));
              } catch (error) {
                // A crash during directory/marker creation can leave no marker.
                if (error.code !== 'ENOENT') throw error;
              }
              if (owner) {
                if (owner.version !== 1 || owner.pid !== Number(match[1]) || owner.session !== match[2] ||
                    !samePath(owner.profile || '', root.real) || !Number.isFinite(owner.createdAt)) throw new Error('Propriétaire invalide.');
                const currentSession = owner.pid === process.pid && owner.session === SESSION;
                if (!currentSession && alive(owner.pid)) { report.retained++; return; }
              } else if (alive(Number(match[1]))) {
                report.retained++; return;
              }
            } else if (Date.now() - stat.mtimeMs < LEGACY_RETENTION_MS) {
              report.retained++; return;
            }
            await removeTurn(root, turn); report.removed++;
          });
        }
      });
      for (const location of [absolute, path.join(absolute, 'pending')]) {
        await attempt(async () => {
          await checkedDirectory(root, location);
          for (const name of await fs.readdir(location)) {
            if (location !== absolute && PENDING.test(name)) {
              await attempt(async () => {
                const stat = await fs.lstat(path.join(location, name));
                if (Date.now() - stat.mtimeMs >= LEGACY_RETENTION_MS) {
                  await unlinkFile(root, location, name); report.removed++;
                }
              });
              continue;
            }
            const match = TEMP.exec(name);
            const legacy = LEGACY_TEMP.exec(name);
            if (!match && !legacy) continue;
            const destination = (match || legacy)[1];
            if (location === absolute ? destination !== 'applications.json' : !PENDING.test(destination)) continue;
            await attempt(async () => {
              const file = path.join(location, name);
              if (activeWrites.has(file)) { report.retained++; return; }
              const stat = await fs.lstat(file);
              if (match) {
                const currentSession = Number(match[2]) === process.pid && match[3] === SESSION;
                if (!currentSession && alive(Number(match[2]))) { report.retained++; return; }
              } else if (Date.now() - stat.mtimeMs < LEGACY_RETENTION_MS) { report.retained++; return; }
              await unlinkFile(root, location, name); report.removed++;
            });
          }
        });
      }
      return report;
    },
    async createTurn() {
      await fs.mkdir(absolute, { recursive: true });
      const root = await rootAt(absolute);
      const turn = await fs.mkdtemp(path.join(absolute, `turn-${process.pid}-${SESSION}-`));
      activeTurns.add(turn);
      try {
        await checkedDirectory(root, turn);
        await fs.writeFile(path.join(turn, '.pam-owner.json'), JSON.stringify({
          version: 1, pid: process.pid, session: SESSION, profile: root.real, createdAt: Date.now(),
        }), { flag: 'wx', mode: 0o600 });
      } catch (error) {
        try { await removeTurn(root, turn); } finally { activeTurns.delete(turn); }
        throw error;
      }
      return { directory: turn, async release() {
        try { await removeTurn(root, turn); }
        finally { activeTurns.delete(turn); }
      } };
    },
  };
}

async function atomicJson(destination, value, profileDirectory = path.dirname(destination)) {
  const directory = path.dirname(path.resolve(destination));
  await fs.mkdir(profileDirectory, { recursive: true });
  const root = await rootAt(profileDirectory);
  // Validate the parent before creating pending, then validate pending itself.
  if (!samePath(directory, root.absolute) && !samePath(path.dirname(directory), root.absolute)) throw new Error('Écriture hors du profil.');
  await checkedDirectory(root, root.absolute);
  await fs.mkdir(directory, { recursive: true });
  await checkedDirectory(root, directory);
  const temporary = `${path.resolve(destination)}.${process.pid}.${SESSION}.${randomUUID()}.tmp`;
  activeWrites.add(temporary);
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
    await checkedDirectory(root, directory);
    await fs.rename(temporary, destination);
  } finally {
    try { await unlinkFile(root, directory, path.basename(temporary)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { activeWrites.delete(temporary); }
  }
}

module.exports = { createTemporaryFiles, atomicJson, LEGACY_RETENTION_MS };
