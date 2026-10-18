import assert from 'node:assert/strict';
import { readFile, stat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolvePortable, verifyPortable } from './portable-integrity.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const store = resolve(process.argv[2] || join(root, 'artifacts/PAM-windows-x64'));
const bundle = await resolvePortable(store);
const distribution = await verifyPortable(bundle);
console.log(
  `Commit livré : ${distribution.identity.commit} ; build ${distribution.identity.buildId}`,
);
const required = [
  'PAM.exe',
  'pam-node.exe',
  'docs/windows-media-deezer.md',
  'docs/media-commands.md',
  'docs/needle-confidence.md',
  'docs/command-aliases.md',
  'docs/deezer-routing.md',
  'sidecar/main.cjs',
  'sidecar/assistant.cjs',
  'sidecar/contracts.json',
  'sidecar/contracts.cjs',
  'sidecar/media.cjs',
  'sidecar/media-commands.cjs',
  'sidecar/deezer.cjs',
  'sidecar/deezer-commands.cjs',
  'sidecar/native.cjs',
  'sidecar/needle-tools.cjs',
  'sidecar/command-aliases.cjs',
  'sidecar/engine.cjs',
  'sidecar/engine-worker.cjs',
  'runtime/libneedle3.dll',
  'runtime/ffi/node_modules/koffi/index.cjs',
  'runtime/needle.exe',
  'runtime/models/needle3.cact',
  'runtime/models/whistle.cact',
  'runtime/npm/bin/npm-cli.js',
];
required.push('sidecar/action-registry.cjs', 'sidecar/action-registry.json');
required.push('sidecar/languages.cjs', 'sidecar/languages.json');
for (const module of [
  'audio',
  'config-repository',
  'confirmation',
  'context-capacity',
  'performance',
  'executor',
  'intent',
  'planner',
  'validation',
])
  required.push(`sidecar/assistant/${module}.cjs`);
for (const module of [
  'budget',
  'config-store',
  'config-schema',
  'config-migrations',
  'execution',
  'proposals',
  'temporary-files',
])
  required.push(`sidecar/${module}.cjs`);
for (const file of required)
  assert.ok((await stat(join(bundle, file))).isFile(), `${file} absent du paquet`);
const manifest = JSON.parse(await readFile(join(bundle, 'runtime/manifest.json'), 'utf8'));
for (const asset of manifest.assets) {
  const bytes = await readFile(join(bundle, 'runtime', asset.file));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    asset.sha256,
    `SHA-256 : ${asset.file}`,
  );
}
assert.equal(
  createHash('sha256')
    .update(await readFile(join(bundle, 'pam-node.exe')))
    .digest('hex'),
  manifest.nodeSha256,
);

function importedLibraries(bytes) {
  const pe = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.toString('ascii', pe, pe + 4), 'PE\0\0');
  assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, 'Le binaire doit être x64.');
  const count = bytes.readUInt16LE(pe + 6);
  const optionalSize = bytes.readUInt16LE(pe + 20);
  const optional = pe + 24;
  assert.equal(bytes.readUInt16LE(optional), 0x20b, 'Format PE32+ attendu.');
  const sections = optional + optionalSize;
  const fileOffset = (rva) => {
    for (let index = 0; index < count; index++) {
      const section = sections + index * 40;
      const address = bytes.readUInt32LE(section + 12);
      const size = Math.max(bytes.readUInt32LE(section + 8), bytes.readUInt32LE(section + 16));
      if (rva >= address && rva < address + size)
        return bytes.readUInt32LE(section + 20) + rva - address;
    }
    throw new Error('RVA PE invalide.');
  };
  const rva = bytes.readUInt32LE(optional + 112 + 8);
  if (!rva) return [];
  const libraries = [];
  for (let offset = fileOffset(rva); bytes.readUInt32LE(offset + 12); offset += 20) {
    const name = fileOffset(bytes.readUInt32LE(offset + 12));
    libraries.push(bytes.toString('ascii', name, bytes.indexOf(0, name)));
  }
  return libraries;
}
for (const file of [
  'PAM.exe',
  'pam-node.exe',
  'runtime/needle.exe',
  'runtime/libneedle3.dll',
  'runtime/ffi/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node',
]) {
  const dlls = importedLibraries(await readFile(join(bundle, file)));
  const extra = dlls.filter((dll) => /^(vcruntime|msvcp|libgcc|libstdc\+\+|python)/i.test(dll));
  assert.deepEqual(extra, [], `${file} nécessite un runtime externe : ${extra.join(', ')}`);
  console.log(`${file} : x64, aucune DLL de runtime externe (${dlls.join(', ')})`);
}
if (process.platform === 'win32') {
  const cache = tmpdir();
  const config = await mkdtemp(join(cache, 'bundle-check-'));
  try {
    const environment = {
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      TEMP: config,
      TMP: config,
      USERPROFILE: config,
      APPDATA: config,
      LOCALAPPDATA: config,
      PATH: '',
      NODE_OPTIONS: '',
      NODE_PATH: '',
    };
    const run = (program, args, input = undefined) =>
      new Promise((done, reject) => {
        const child = spawn(program, args, {
          cwd: config,
          windowsHide: true,
          env: environment,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let out = '',
          err = '';
        const timer = setTimeout(() => {
          if (child.pid)
            execFile(
              join(process.env.SystemRoot, 'System32/taskkill.exe'),
              ['/PID', String(child.pid), '/T', '/F'],
              { windowsHide: true },
              () => {},
            );
          else child.kill();
        }, 90_000);
        child.stdout.on('data', (b) => {
          out += b;
        });
        child.stderr.on('data', (b) => {
          err += b;
        });
        child.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          code === 0 ? done(out) : reject(new Error(err || out || `Exit ${code}`));
        });
        child.stdin.on('error', () => {});
        child.stdin.end(input);
      });
    assert.deepEqual(
      JSON.parse(await run(join(bundle, 'PAM.exe'), ['--pam-build-info'])),
      distribution.identity,
    );
    const native = JSON.parse(
      await run(
        join(bundle, 'PAM.exe'),
        ['--pam-native'],
        JSON.stringify({
          version: 1,
          id: 1,
          requestId: '11111111-1111-4111-8111-111111111111',
          method: 'media_sessions',
          payload: {},
        }),
      ),
    );
    assert.equal(native.ok, true);
    assert.ok(Array.isArray(native.result));
    console.log('Identité et adaptateur natif du binaire final avec PATH vide : OK');
    console.log(
      await run(join(bundle, 'pam-node.exe'), [
        join(root, 'scripts/smoke-portable.cjs'),
        bundle,
        config,
      ]),
    );
    const reply = await new Promise((resolve, reject) => {
      const child = spawn(
        join(bundle, 'pam-node.exe'),
        [join(bundle, 'sidecar/main.cjs'), join(bundle, 'runtime'), config],
        {
          cwd: config,
          windowsHide: true,
          env: environment,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Status expiré'));
      }, 90_000);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr || stdout));
      });
      child.stdin.end(
        JSON.stringify({
          version: 1,
          id: 1,
          requestId: '11111111-1111-4111-8111-111111111111',
          method: 'status',
          payload: {},
        }),
      );
    });
    assert.equal(reply.ok, true);
    assert.equal(reply.result.ready, true);
    assert.equal(reply.result.engine.loaded, true);
    console.log('Sidecar du paquet lancé avec PATH vide : OK');
  } finally {
    assert.equal(dirname(config), cache);
    assert.ok(config.startsWith(join(cache, 'bundle-check-')));
    await rm(config, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}
console.log('Paquet Windows x64 vérifié.');
