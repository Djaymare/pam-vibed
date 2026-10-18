import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, rename, rm, lstat } from 'node:fs/promises';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hash, treeFiles, verifyTree } from './runtime-integrity.mjs';

export const target = 'x86_64-pc-windows-msvc';
export const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
export const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
async function replacePointer(from, to) {
  // Windows readers/antivirus can briefly hold the destination open. Never unlink it:
  // every failed attempt leaves the old complete publication visible to readers.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 49) throw error;
      await new Promise((done) => setTimeout(done, 20));
    }
  }
}
const codeFile = (p) => !/^(docs\/tickets\/|docs\/autonomy\/|AGENTS?\.md$)/.test(p);
export function safePath(root, name) {
  assert.ok(
    name &&
      !name.includes('\\') &&
      !name.includes(':') &&
      !name.split('/').some((p) => ['', '.', '..'].includes(p)),
    `Chemin invalide : ${name}`,
  );
  const path = resolve(root, name),
    rel = relative(resolve(root), path);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Chemin hors du dossier autorisé');
  return path;
}
export async function inventory(root, files = undefined) {
  const result = {};
  for (const file of (files || (await treeFiles(root))).sort()) {
    const path = safePath(root, file);
    assert.ok((await lstat(path)).isFile(), `Fichier régulier requis : ${file}`);
    result[file] = await hash(path);
  }
  return result;
}
export async function sources(root) {
  const list = (...args) =>
    execFileSync('git', ['-C', root, ...args, '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter((p) => p && codeFile(p));
  const files = list('ls-files');
  assert.deepEqual(
    [...list('diff', 'HEAD', '--name-only'), ...list('ls-files', '--others', '--exclude-standard')],
    [],
    'Commiter les sources avant le build de distribution',
  );
  return inventory(root, files);
}
export function binaryIdentity(bytes) {
  const prefix = Buffer.from('PAM_BUILD_INFO:');
  const start = bytes.indexOf(Buffer.from('PAM_BUILD_INFO:{"version":'));
  assert.ok(start >= 0, 'Binaire sans identité de build ; reconstruire avec build:portable');
  const end = bytes.indexOf(Buffer.from(':END_PAM_BUILD_INFO'), start + prefix.length);
  assert.ok(end > start, 'Identité binaire incomplète');
  return JSON.parse(bytes.subarray(start + prefix.length, end).toString('utf8'));
}
export async function deliveryInputs(root) {
  const runtime = await json(join(root, 'src-tauri/runtime/manifest.json'));
  await verifyTree(join(root, 'src-tauri/runtime'), {
    ...Object.fromEntries(runtime.assets.map((a) => [a.file, a.sha256])),
    'manifest.json': await hash(join(root, 'src-tauri/runtime/manifest.json')),
  });
  const files = {
    'pam-node.exe': 'src-tauri/binaries/pam-node-' + target + '.exe',
    'README.md': 'README.md',
  };
  for (const [from, to] of [
    ['src-tauri/runtime', 'runtime'],
    ['sidecar', 'sidecar'],
    ['dist', 'frontend'],
    ['docs', 'docs'],
  ]) {
    const actual = await treeFiles(join(root, from));
    if (from === 'sidecar' || from === 'docs') {
      const expected = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', from], {
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean)
        .map((p) => p.slice(from.length + 1));
      const included = (p) =>
        from === 'sidecar' ? !p.endsWith('.test.cjs') : !/^(tickets|autonomy)\//.test(p);
      assert.deepEqual(
        actual.filter(included).sort(),
        expected.filter(included).sort(),
        `Inventaire ${from} différent des sources versionnées`,
      );
    }
    for (const p of actual) {
      if (from === 'sidecar' && p.endsWith('.test.cjs')) continue;
      if (from === 'docs' && /^(tickets|autonomy)\//.test(p)) continue;
      files[`${to}/${p}`] = `${from}/${p}`;
    }
  }
  assert.equal(
    await hash(join(root, files['pam-node.exe'])),
    runtime.nodeSha256,
    'Node embarqué incorrect',
  );
  const hashes = {};
  for (const [to, from] of Object.entries(files).sort()) hashes[to] = await hash(join(root, from));
  return { files, hashes };
}
export async function checkedBuild(root, receiptPath) {
  const receipt = await json(receiptPath);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.identity.target, target);
  git(root, 'merge-base', '--is-ancestor', receipt.identity.commit, 'HEAD');
  assert.deepEqual(
    await sources(root),
    receipt.identity.sources,
    'Sources différentes du build courant',
  );
  const binary = safePath(root, receipt.binary);
  assert.equal(await hash(binary), receipt.binarySha256, 'Binaire obsolète ou modifié');
  assert.deepEqual(
    binaryIdentity(await readFile(binary)),
    receipt.identity,
    'Identité du binaire différente du reçu',
  );
  const inputs = await deliveryInputs(root);
  assert.deepEqual(
    inputs.hashes,
    receipt.identity.files,
    'Ressource/front/sidecar différent du build courant',
  );
  return { receipt, binary, inputs };
}
export async function verifyPortable(bundle, expectedIdentity = undefined) {
  const manifest = await json(join(bundle, 'distribution.json'));
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.identity.commit, /^[a-f0-9]{40}$/);
  if (expectedIdentity) assert.deepEqual(manifest.identity, expectedIdentity);
  assert.deepEqual(
    Object.keys(manifest.files).sort(),
    ['PAM.exe', ...Object.keys(manifest.identity.files)].sort(),
    'Inventaire distribué différent du build',
  );
  await verifyTree(bundle, {
    ...manifest.files,
    'distribution.json': await hash(join(bundle, 'distribution.json')),
  });
  assert.deepEqual(binaryIdentity(await readFile(join(bundle, 'PAM.exe'))), manifest.identity);
  for (const [p, sha] of Object.entries(manifest.identity.files))
    assert.equal(manifest.files[p], sha, `Ressource non liée au binaire : ${p}`);
  assert.deepEqual(await json(join(bundle, 'frontend/build-identity.json')), {
    version: manifest.identity.version,
    commit: manifest.identity.commit,
    buildId: manifest.identity.buildId,
  });
  return manifest;
}
export async function resolvePortable(store) {
  const pointer = await json(join(store, 'current.json'));
  assert.match(pointer.release, /^releases\/[a-f0-9-]{36}$/);
  const bundle = safePath(store, pointer.release);
  assert.equal(
    await hash(join(bundle, 'distribution.json')),
    pointer.manifestSha256,
    'Pointeur de distribution incorrect',
  );
  return bundle;
}
export async function publishPortable(root, destination, receiptPath) {
  const store = resolve(destination),
    rel = relative(join(root, 'artifacts'), store);
  assert.ok(
    rel && !rel.startsWith('..') && !isAbsolute(rel),
    'La sortie doit être un sous-dossier de artifacts/',
  );
  const { receipt, binary, inputs } = await checkedBuild(root, receiptPath);
  // Check each existing ancestor before creating children, including Windows junctions.
  let parent = resolve(root);
  for (const part of relative(root, join(store, 'releases')).split(/[\\/]/)) {
    parent = join(parent, part);
    try {
      await mkdir(parent);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const info = await lstat(parent);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Sortie symbolique interdite');
  }
  const id = randomUUID(),
    stage = safePath(store, `.stage-${id}`),
    releaseName = `releases/${id}`,
    release = safePath(store, releaseName);
  const pointerTmp = safePath(store, `.current-${id}.tmp`);
  await mkdir(stage);
  try {
    await copyFile(binary, join(stage, 'PAM.exe'));
    for (const [to, from] of Object.entries(inputs.files)) {
      const path = safePath(stage, to);
      await mkdir(dirname(path), { recursive: true });
      await copyFile(safePath(root, from), path);
    }
    const manifest = {
      schemaVersion: 1,
      identity: receipt.identity,
      files: await inventory(stage),
    };
    await writeFile(join(stage, 'distribution.json'), JSON.stringify(manifest, null, 2) + '\n', {
      flag: 'wx',
    });
    await verifyPortable(stage, receipt.identity);
    await checkedBuild(root, receiptPath);
    await rename(stage, release);
    await writeFile(
      pointerTmp,
      JSON.stringify({
        schemaVersion: 1,
        release: releaseName,
        manifestSha256: await hash(join(release, 'distribution.json')),
      }) + '\n',
      { flag: 'wx' },
    );
    await replacePointer(pointerTmp, join(store, 'current.json'));
    return release;
  } finally {
    assert.equal(dirname(stage), store);
    await rm(stage, { recursive: true, force: true });
    await rm(pointerTmp, { force: true });
  }
}
