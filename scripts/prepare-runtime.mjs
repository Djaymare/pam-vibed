import { open, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  download,
  hash,
  digest,
  zipEntries,
  tarEntries,
  ensureTree,
  loadCatalog,
  treeFiles,
  entryHashes,
} from './runtime-integrity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, 'src-tauri/runtime'),
  binaries = join(root, 'src-tauri/binaries'),
  cache = join(root, '.runtime-cache');
async function copyVerified(source, destination, sha256) {
  try {
    if ((await hash(destination)) === sha256) return;
  } catch {}
  await copyFile(source, destination);
  if ((await hash(destination)) !== sha256)
    throw new Error(`Copie runtime incorrecte : ${destination}`);
}
await mkdir(cache, { recursive: true });
const lockPath = join(cache, 'prepare-runtime.lock');
const lock = await open(lockPath, 'wx'); // Never run two cache writers together.
try {
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  const catalog = await loadCatalog(root);
  await mkdir(binaries, { recursive: true });
  const component = (id) => catalog.components.find((c) => c.id === id);
  const node = component('node');
  const nodeArchive = join(cache, node.cache);
  await download(node.url, nodeArchive, node.sha256);
  const nodeEntries = zipEntries(await readFile(nodeArchive), node.prefix);
  const extracted = join(cache, node.prefix.slice(0, -1));
  const nodeCheck = await ensureTree(extracted, nodeEntries);
  if (nodeCheck.repaired) console.log(`Cache Node reconstruit : ${nodeCheck.reason}`);
  if ((await hash(join(extracted, 'node.exe'))) !== node.nodeSha256)
    throw new Error('Node extrait incorrect.');
  await copyVerified(
    join(extracted, 'node.exe'),
    join(binaries, 'pam-node-x86_64-pc-windows-msvc.exe'),
    node.nodeSha256,
  );
  const npmEntries = new Map(
    [...nodeEntries]
      .filter(([p]) => p.startsWith('node_modules/npm/'))
      .map(([p, bytes]) => [p.slice('node_modules/npm/'.length), bytes]),
  );
  const expected = Object.fromEntries(
    [...npmEntries].map(([p, bytes]) => [`npm/${p}`, digest(bytes)]),
  );
  expected['NODE-LICENSE.txt'] = digest(nodeEntries.get('LICENSE'));
  await ensureTree(join(runtime, 'npm'), npmEntries);
  await mkdir(runtime, { recursive: true });
  await copyFile(join(extracted, 'LICENSE'), join(runtime, 'NODE-LICENSE.txt'));
  for (const c of catalog.components.filter((c) => c.id !== 'node')) {
    if (!c.format) {
      await download(c.url, join(runtime, c.file), c.sha256);
      expected[c.file] = c.sha256;
      continue;
    }
    const archive = join(cache, c.cache);
    await download(c.url, archive, c.sha256);
    const entries =
      c.format === 'zip'
        ? zipEntries(await readFile(archive))
        : tarEntries(await readFile(archive));
    const destination = c.extracted ? join(cache, c.extracted) : join(runtime, c.destination);
    const check = await ensureTree(destination, entries);
    if (c.destination)
      for (const [p, sha] of Object.entries(entryHashes(entries)))
        expected[`${c.destination}/${p}`] = sha;
    if (check.repaired) console.log(`Cache ${c.id} reconstruit : ${check.reason}`);
    if (c.archiveFile) {
      if ((await hash(join(destination, c.archiveFile))) !== c.fileSha256)
        throw new Error(`DLL extraite incorrecte : ${c.id}`);
      await copyVerified(join(destination, c.archiveFile), join(runtime, c.file), c.fileSha256);
      expected[c.file] = c.fileSha256;
    }
  }
  for (const license of catalog.licenses) {
    await download(license.url, join(runtime, license.file), license.sha256);
    expected[license.file] = license.sha256;
  }
  const npm = JSON.parse(await readFile(join(runtime, 'npm/package.json'), 'utf8')).version;
  const assets = [];
  const { rm } = await import('node:fs/promises');
  await rm(join(runtime, 'manifest.json.partial'), { force: true });
  const actual = (await treeFiles(runtime)).filter((file) => file !== 'manifest.json');
  if (JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(expected).sort()))
    throw new Error(
      'Fichiers runtime inattendus/manquants ; inspecter sans les incorporer au manifeste.',
    );
  // Include every shipped runtime file, including all npm/Koffi code and licenses.
  for (const file of actual) {
    if ((await hash(join(runtime, file))) !== expected[file])
      throw new Error(`Runtime modifié pendant la préparation : ${file}`);
    assets.push({ file, sha256: expected[file] });
  }
  const manifest = {
    schemaVersion: 2,
    target: catalog.target,
    node: node.version,
    npm,
    nodeSha256: node.nodeSha256,
    needleRevision: component('needle').revision,
    whistleRevision: component('whistle-model').revision,
    ffi: 'koffi ' + component('koffi').version,
    catalogSha256: await hash(join(root, 'security/runtime-components.json')),
    assets,
  };
  await writeFile(join(runtime, 'manifest.json.partial'), JSON.stringify(manifest, null, 2) + '\n');
  const { rename } = await import('node:fs/promises');
  await rename(join(runtime, 'manifest.json.partial'), join(runtime, 'manifest.json'));
  console.log(
    `Runtime Windows x64 prêt : Node ${node.version}, npm ${npm}, ${assets.length} fichiers vérifiés.`,
  );
} finally {
  await lock.close();
  const { unlink } = await import('node:fs/promises');
  await unlink(lockPath);
}
