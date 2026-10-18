import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, readdir, lstat, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { inflateRawSync, gunzipSync } from 'node:zlib';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function hash(path, algorithm = 'sha256') {
  const h = createHash(algorithm);
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}

export async function download(url, destination, sha256, fetcher = fetch) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('SHA-256 épinglé requis.');
  await mkdir(dirname(destination), { recursive: true });
  // A partial is never a cache hit. prepare-runtime owns an exclusive lock.
  const partial = `${destination}.partial`;
  await rm(partial, { force: true });
  try {
    if ((await hash(destination)) === sha256) return;
  } catch {}
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body)
      throw new Error(`Téléchargement ${response.status} : ${url}`);
    const h = createHash('sha256');
    await pipeline(
      response.body,
      new Transform({
        transform(chunk, encoding, done) {
          h.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(partial, { flags: 'wx' }),
    );
    if (h.digest('hex') !== sha256) throw new Error(`Empreinte SHA-256 incorrecte : ${url}`);
    await rename(partial, destination);
  } finally {
    await rm(partial, { force: true });
  }
}

function safeName(name) {
  if (
    !name ||
    name.includes('\\') ||
    name.includes(':') ||
    name.startsWith('/') ||
    name.split('/').some((p) => p === '..' || p === '.' || p === '')
  )
    throw new Error(`Chemin d'archive invalide : ${name}`);
  return name;
}
function add(entries, name, bytes) {
  safeName(name);
  if ([...entries.keys()].some((key) => key.toLowerCase() === name.toLowerCase()))
    throw new Error(`Entrée dupliquée : ${name}`);
  entries.set(name, bytes);
}
export function zipEntries(bytes, prefix = '') {
  const result = new Map();
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw new Error('Archive ZIP invalide.');
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Répertoire ZIP invalide.');
    const compression = bytes.readUInt16LE(offset + 10),
      compressedSize = bytes.readUInt32LE(offset + 20),
      size = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28),
      extraSize = bytes.readUInt16LE(offset + 30),
      commentSize = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42),
      name = bytes.toString('utf8', offset + 46, offset + 46 + nameSize);
    if (((bytes.readUInt32LE(offset + 38) >>> 16) & 0xf000) === 0xa000)
      throw new Error('Lien ZIP interdit.');
    safeName(name.replace(/\/$/, ''));
    if (!name.startsWith(prefix)) throw new Error(`Préfixe ZIP inattendu : ${name}`);
    if (!name.endsWith('/')) {
      if (bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('Entrée ZIP invalide.');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + compressedSize > bytes.length) throw new Error('ZIP tronqué.');
      const compressed = bytes.subarray(start, start + compressedSize);
      const content =
        compression === 0 ? compressed : compression === 8 ? inflateRawSync(compressed) : null;
      if (!content || content.length !== size) throw new Error('Compression ZIP invalide.');
      add(result, name.slice(prefix.length), content);
    }
    offset += 46 + nameSize + extraSize + commentSize;
  }
  if (!result.size) throw new Error('Archive ZIP vide.');
  return result;
}
export function tarEntries(archive) {
  const bytes = gunzipSync(archive),
    result = new Map();
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString().split('\0')[0];
    const sizeText = header.subarray(124, 136).toString().replace(/\0/g, '').trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Taille TAR invalide.');
    const size = parseInt(sizeText, 8),
      type = header[156];
    if (offset + 512 + size > bytes.length) throw new Error('TAR tronqué.');
    if (type === 0 || type === 48) {
      if (!name.startsWith('package/')) throw new Error('Archive npm invalide.');
      add(result, name.slice(8), bytes.subarray(offset + 512, offset + 512 + size));
    } else if (type !== 53) throw new Error('Entrée TAR non régulière interdite.');
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!result.size) throw new Error('Archive TAR vide.');
  return result;
}

export async function treeFiles(root, prefix = '') {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
    throw new Error(`Répertoire régulier requis : ${root}`);
  const files = [];
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const file = prefix ? `${prefix}/${name}` : name;
    const info = await lstat(join(root, file));
    if (info.isSymbolicLink()) throw new Error(`Lien interdit : ${file}`);
    if (info.isDirectory()) files.push(...(await treeFiles(root, file)));
    else if (info.isFile()) files.push(file);
    else throw new Error(`Fichier non régulier : ${file}`);
  }
  return files;
}
export async function verifyTree(root, expected) {
  const files = await treeFiles(root),
    names = Object.keys(expected).sort();
  if (JSON.stringify(files.sort()) !== JSON.stringify(names))
    throw new Error(`Inventaire de fichiers incorrect : ${root}`);
  for (const name of names)
    if ((await hash(join(root, name))) !== expected[name])
      throw new Error(`SHA-256 incorrect : ${name}`);
}
export const entryHashes = (entries) =>
  Object.fromEntries([...entries].map(([name, bytes]) => [name, digest(bytes)]));

export async function ensureTree(destination, entries) {
  const expected = entryHashes(entries);
  try {
    await verifyTree(destination, expected);
    return { repaired: false, files: expected };
  } catch (error) {
    const parent = dirname(resolve(destination)),
      stage = `${resolve(destination)}.stage-${randomUUID()}`,
      backup = `${resolve(destination)}.old-${randomUUID()}`;
    const remove = async (path) => {
      const rel = relative(parent, resolve(path));
      if (!rel || rel.startsWith('..') || isAbsolute(rel))
        throw new Error('Nettoyage hors du cache.');
      await rm(path, { recursive: true, force: true });
    };
    let moved = false;
    try {
      await mkdir(stage, { recursive: true });
      for (const [name, bytes] of entries) {
        safeName(name);
        await mkdir(dirname(join(stage, name)), { recursive: true });
        await writeFile(join(stage, name), bytes);
      }
      await verifyTree(stage, expected);
      try {
        await rename(destination, backup);
        moved = true;
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      try {
        await rename(stage, destination);
      } catch (e) {
        if (moved) {
          await rename(backup, destination);
          moved = false;
        }
        throw e;
      }
      if (moved) await remove(backup);
      return { repaired: true, reason: error.message, files: expected };
    } finally {
      await remove(stage);
    }
  }
}

export async function loadCatalog(root) {
  return JSON.parse(await readFile(join(root, 'security/runtime-components.json'), 'utf8'));
}
