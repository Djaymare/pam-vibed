import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  sources,
  deliveryInputs,
  publishPortable,
  verifyPortable,
  resolvePortable,
  target,
  binaryIdentity,
  safePath,
} from '../scripts/portable-integrity.mjs';
import { hash, digest } from '../scripts/runtime-integrity.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pam-portable-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const put = async (p, value) => {
    await mkdir(dirname(join(root, p)), { recursive: true });
    await writeFile(join(root, p), value);
  };
  const git = (...args) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  await put('.gitignore', 'artifacts/\ndist/\nsrc-tauri/runtime/\nsrc-tauri/binaries/\n');
  await put('README.md', 'fixture');
  await put('sidecar/main.cjs', 'fixture');
  await put('docs/guide.md', 'guide');
  git('init', '-q');
  git('add', '.gitignore', 'README.md', 'sidecar/main.cjs', 'docs/guide.md');
  git(
    '-c',
    'user.name=PAM test',
    '-c',
    'user.email=pam-test@example.invalid',
    'commit',
    '-qm',
    'fixture',
  );
  const identity = {
    version: '0.1.0',
    commit: git('rev-parse', 'HEAD'),
    buildId: randomUUID(),
    target,
    sources: await sources(root),
  };
  await put('src-tauri/binaries/pam-node-' + target + '.exe', 'node-fixture');
  await put('src-tauri/runtime/model.cact', 'model-fixture');
  await put(
    'src-tauri/runtime/manifest.json',
    JSON.stringify({
      nodeSha256: digest('node-fixture'),
      assets: [{ file: 'model.cact', sha256: digest('model-fixture') }],
    }),
  );
  await put('dist/index.html', 'front-fixture');
  await put(
    'dist/build-identity.json',
    JSON.stringify({
      version: identity.version,
      commit: identity.commit,
      buildId: identity.buildId,
    }),
  );
  identity.files = (await deliveryInputs(root)).hashes;
  // A marker fixture exercises freshness and inventory checks, not PE or native behavior.
  await put(
    'artifacts/build/pam.exe',
    `fixture\0PAM_BUILD_INFO:${JSON.stringify(identity)}:END_PAM_BUILD_INFO`,
  );
  const receipt = join(root, 'artifacts/build/windows-x64.json');
  await writeFile(
    receipt,
    JSON.stringify({
      schemaVersion: 1,
      identity,
      binary: 'artifacts/build/pam.exe',
      binarySha256: await hash(join(root, 'artifacts/build/pam.exe')),
    }),
  );
  const store = join(root, 'artifacts/portable');
  return { root, store, receipt, identity, put };
}
test('publication atomique : une nouvelle distribution ne fusionne aucun ancien fichier', async (t) => {
  const f = await fixture(t);
  const old = await publishPortable(f.root, f.store, f.receipt);
  await writeFile(join(old, 'obsolete.txt'), 'old');
  const oldPointer = await readFile(join(f.store, 'current.json'), 'utf8');
  const observations = [],
    errors = [];
  let observing = true;
  const observer = (async () => {
    while (observing) {
      try {
        observations.push(await resolvePortable(f.store));
      } catch (e) {
        errors.push(e);
      }
    }
  })();
  let current;
  try {
    current = await publishPortable(f.root, f.store, f.receipt);
  } finally {
    observing = false;
    await observer;
  }
  assert.ok(observations.length > 0);
  assert.deepEqual(errors, [], 'Chaque lecture concurrente voit un pointeur complet');
  assert.ok(observations.every((p) => p === old || p === current));
  assert.notEqual(current, old);
  assert.notEqual(await readFile(join(f.store, 'current.json'), 'utf8'), oldPointer);
  assert.equal(await resolvePortable(f.store), current);
  await assert.rejects(access(join(current, 'obsolete.txt')));
  await verifyPortable(current, f.identity);
  assert.equal(await readFile(join(old, 'obsolete.txt'), 'utf8'), 'old');
});
test('binaire obsolète et reçu sans provenance refusés avant publication', async (t) => {
  const f = await fixture(t);
  await f.put('artifacts/build/pam.exe', 'stale executable');
  await assert.rejects(publishPortable(f.root, f.store, f.receipt), /Binaire obsolète/);
  await writeFile(f.receipt, '{"schemaVersion":0}');
  await assert.rejects(publishPortable(f.root, f.store, f.receipt));
  await assert.rejects(access(join(f.store, 'current.json')));
});
test('ressource manquante ou modifiée : publication refusée, ancien pointeur préservé', async (t) => {
  for (const resource of ['src-tauri/runtime/model.cact', 'sidecar/main.cjs', 'dist/index.html']) {
    const f = await fixture(t);
    await publishPortable(f.root, f.store, f.receipt);
    const pointer = await readFile(join(f.store, 'current.json'), 'utf8');
    await rm(join(f.root, resource));
    await assert.rejects(publishPortable(f.root, f.store, f.receipt));
    assert.equal(await readFile(join(f.store, 'current.json'), 'utf8'), pointer);
    await verifyPortable(await resolvePortable(f.store));
  }
});
test('manifeste intégral : ajout, suppression et altération du paquet sont détectés', async (t) => {
  for (const mutation of ['extra', 'missing', 'changed']) {
    const f = await fixture(t),
      bundle = await publishPortable(f.root, f.store, f.receipt);
    if (mutation === 'extra') await writeFile(join(bundle, 'extra.cjs'), 'extra');
    if (mutation === 'missing') await rm(join(bundle, 'sidecar/main.cjs'));
    if (mutation === 'changed') await writeFile(join(bundle, 'frontend/index.html'), 'changed');
    await assert.rejects(verifyPortable(bundle));
  }
});
test('commit annoncé et identité binaire/front doivent correspondre au reçu', async (t) => {
  const f = await fixture(t),
    bundle = await publishPortable(f.root, f.store, f.receipt);
  assert.deepEqual(binaryIdentity(await readFile(join(bundle, 'PAM.exe'))), f.identity);
  const changed = { ...f.identity, commit: 'f'.repeat(40) };
  await f.put(
    'artifacts/build/pam.exe',
    `PAM_BUILD_INFO:${JSON.stringify(changed)}:END_PAM_BUILD_INFO`,
  );
  const receipt = JSON.parse(await readFile(f.receipt, 'utf8'));
  receipt.binarySha256 = await hash(join(f.root, 'artifacts/build/pam.exe'));
  await writeFile(f.receipt, JSON.stringify(receipt));
  await assert.rejects(publishPortable(f.root, f.store, f.receipt), /Identité du binaire/);
});
test('sortie bornée, chemins traversants et liens refusés', async (t) => {
  const f = await fixture(t);
  await assert.rejects(publishPortable(f.root, f.root, f.receipt), /sous-dossier/);
  for (const p of ['../outside', 'C:/outside', 'nested/../outside', '/outside'])
    assert.throws(() => safePath(f.root, p));
  await symlink(join(f.root, 'docs'), join(f.root, 'sidecar/link'), 'junction');
  await assert.rejects(deliveryInputs(f.root), /Lien interdit/);
  const linked = await fixture(t);
  await mkdir(join(linked.root, 'artifacts'), { recursive: true });
  await symlink(join(linked.root, 'docs'), linked.store, 'junction');
  await assert.rejects(
    publishPortable(linked.root, linked.store, linked.receipt),
    /Sortie symbolique/,
  );
  await assert.rejects(access(join(linked.root, 'docs/releases')));
});
