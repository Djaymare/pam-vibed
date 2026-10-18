import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, rename, copyFile, open, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  sources,
  git,
  json,
  deliveryInputs,
  target,
  binaryIdentity,
} from './portable-integrity.mjs';
import { hash } from './runtime-integrity.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'artifacts/build');
await mkdir(output, { recursive: true });
const lockPath = join(output, 'build.lock');
const lock = await open(lockPath, 'wx');
try {
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  const receiptPath = join(output, 'windows-x64.json');
  await writeFile(receiptPath, JSON.stringify({ schemaVersion: 0, error: 'Build not completed' }));
  const original = await sources(root);
  const version = (await json(join(root, 'package.json'))).version;
  assert.equal((await json(join(root, 'src-tauri/tauri.conf.json'))).version, version);
  const identity = {
    version,
    commit: git(root, 'rev-parse', 'HEAD'),
    buildId: randomUUID(),
    target,
    sources: original,
  };
  const identityPath = join(output, 'identity.json');
  await writeFile(identityPath, JSON.stringify(identity));
  const env = { ...process.env, PAM_BUILD_IDENTITY: identityPath };
  async function run(program, args) {
    await new Promise((done, reject) => {
      const child = spawn(program, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? done() : reject(new Error(`${program} : ${code}`))));
    });
  }
  await run(process.execPath, [join(root, 'scripts/prepare-runtime.mjs')]);
  await run(process.execPath, [join(root, 'node_modules/vue-tsc/bin/vue-tsc.js'), '--noEmit']);
  await run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build']);
  identity.files = (await deliveryInputs(root)).hashes;
  await writeFile(identityPath, JSON.stringify(identity));
  const args = ['build', '--target', target];
  if (process.argv.includes('--docker')) args.push('--runner', 'cargo-xwin');
  if (!process.argv.includes('--nsis')) args.push('--no-bundle');
  args.push('--config', JSON.stringify({ build: { beforeBuildCommand: '' } }), '--', '--locked');
  await run(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), ...args]);
  assert.deepEqual(await sources(root), original, 'Sources modifiées pendant le build');
  assert.deepEqual(
    (await deliveryInputs(root)).hashes,
    identity.files,
    'Ressources modifiées pendant le build',
  );
  const binary = join(
    resolve(root, process.env.CARGO_TARGET_DIR || 'src-tauri/target'),
    target,
    'release/pam.exe',
  );
  assert.deepEqual(
    binaryIdentity(await readFile(binary)),
    identity,
    'Binaire étranger au build courant',
  );
  await copyFile(binary, join(output, 'pam.exe'));
  const receipt = {
    schemaVersion: 1,
    identity,
    binary: 'artifacts/build/pam.exe',
    binarySha256: await hash(binary),
    completedAt: new Date().toISOString(),
  };
  await writeFile(receiptPath + '.tmp', JSON.stringify(receipt, null, 2) + '\n');
  await rename(receiptPath + '.tmp', receiptPath);
  console.log(`Build Windows vérifié : ${identity.commit}, ${identity.buildId}`);
} finally {
  await lock.close();
  await unlink(lockPath);
}
