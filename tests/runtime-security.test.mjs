import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  download,
  digest,
  ensureTree,
  verifyTree,
  entryHashes,
  zipEntries,
  tarEntries,
} from '../scripts/runtime-integrity.mjs';
import { npmComponents, cargoLockPackages, generateSbom } from '../scripts/security-sbom.mjs';
import {
  auditQueries,
  osvAudit,
  monitorRuntime,
  runAudit,
  verifyBomInputs,
} from '../scripts/security-audit.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pam-security-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('une altération npm hors node.exe, un manque et un fichier ajouté sont détectés et réparés', async (t) => {
  const root = await fixture(t),
    dir = join(root, 'node');
  const entries = new Map([
    ['node.exe', Buffer.from('node-fixture')],
    ['node_modules/npm/bin/npm-cli.js', Buffer.from('npm-fixture')],
    ['LICENSE', Buffer.from('license')],
  ]);
  assert.equal((await ensureTree(dir, entries)).repaired, true);
  assert.equal((await ensureTree(dir, entries)).repaired, false);
  for (const corrupt of [
    async () => writeFile(join(dir, 'node_modules/npm/bin/npm-cli.js'), 'altered'),
    async () => rm(join(dir, 'LICENSE')),
    async () => writeFile(join(dir, 'injected.js'), 'unexpected'),
  ]) {
    await corrupt();
    await assert.rejects(verifyTree(dir, entryHashes(entries)));
    assert.equal(await readFile(join(dir, 'node.exe'), 'utf8'), 'node-fixture');
    assert.equal((await ensureTree(dir, entries)).repaired, true);
    await verifyTree(dir, entryHashes(entries));
  }
});

test('un cache incomplet et un cache contenant une jonction ne sont pas réutilisés', async (t) => {
  const root = await fixture(t),
    destination = join(root, 'cache'),
    outside = join(root, 'external');
  await mkdir(outside);
  await writeFile(join(outside, 'file'), 'trusted');
  await symlink(outside, destination, process.platform === 'win32' ? 'junction' : 'dir');
  const entries = new Map([['file', Buffer.from('trusted')]]);
  await assert.rejects(verifyTree(destination, entryHashes(entries)), /Répertoire régulier/);
  await ensureTree(destination, entries);
  await verifyTree(destination, entryHashes(entries));
  assert.equal(await readFile(join(outside, 'file'), 'utf8'), 'trusted');
});

test('téléchargement interrompu ou invalide conserve la destination et supprime le partiel', async (t) => {
  const root = await fixture(t),
    file = join(root, 'archive'),
    wanted = Buffer.from('verified');
  await writeFile(file, 'old');
  await writeFile(file + '.partial', 'stale interrupted bytes');
  const interrupted = async () => ({
    ok: true,
    body: new ReadableStream({
      start(c) {
        c.enqueue(Buffer.from('short'));
        c.error(new Error('connection lost'));
      },
    }),
  });
  await assert.rejects(
    download('https://example.invalid/archive', file, digest(wanted), interrupted),
    /connection lost/,
  );
  assert.equal(await readFile(file, 'utf8'), 'old');
  await assert.rejects(stat(file + '.partial'), { code: 'ENOENT' });
  await assert.rejects(
    download(
      'https://example.invalid/archive',
      file,
      digest(wanted),
      async () => new Response('bad'),
    ),
    /SHA-256 incorrecte/,
  );
  assert.equal(await readFile(file, 'utf8'), 'old');
  await download(
    'https://example.invalid/archive',
    file,
    digest(wanted),
    async () => new Response(wanted),
  );
  assert.equal(await readFile(file, 'utf8'), 'verified');
  await writeFile(file + '.partial', 'stale');
  await download('https://example.invalid/archive', file, digest(wanted), () =>
    assert.fail('verified archive must be cached'),
  );
  await assert.rejects(stat(file + '.partial'), { code: 'ENOENT' });
});

function zip(name, bytes = Buffer.from('content')) {
  const n = Buffer.from(name),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt32LE(bytes.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(n.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt32LE(bytes.length, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(n.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(local.length + n.length + bytes.length, 16);
  return Buffer.concat([local, n, bytes, central, n, end]);
}
function tar(name, content = Buffer.from('content'), type = 48) {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write(content.length.toString(8).padStart(11, '0'), 124);
  header[156] = type;
  return gzipSync(
    Buffer.concat([
      header,
      content,
      Buffer.alloc((512 - (content.length % 512)) % 512),
      Buffer.alloc(512),
    ]),
  );
}
test('archives bornées : extraction réelle, refus traversée, liens et troncature', () => {
  assert.equal(zipEntries(zip('node/file'), 'node/').get('file').toString(), 'content');
  assert.equal(tarEntries(tar('package/file')).get('file').toString(), 'content');
  for (const name of ['../escape', 'node/../../escape', 'C:/escape', 'node\\escape'])
    assert.throws(() => zipEntries(zip(name)));
  assert.throws(() => zipEntries(zip('other/file'), 'node/'));
  assert.throws(() => zipEntries(zip('node/file').subarray(0, 40)));
  assert.throws(() => tarEntries(tar('package/../escape')));
  assert.throws(() => tarEntries(tar('package/link', Buffer.from('target'), 50)), /non régulière/);
  const truncated = Buffer.alloc(512);
  truncated.write('package/file');
  truncated.write('00000002000', 124);
  truncated[156] = 48;
  assert.throws(() => tarEntries(gzipSync(truncated)), /tronqué/);
});

test('le SBOM réconcilie npm, toutes les crates, composants manuels et npm embarqué', async (t) => {
  const root = await fixture(t);
  for (const dir of ['security', 'src-tauri/runtime/npm/node_modules/vendor', 'src-tauri'])
    await mkdir(join(root, dir), { recursive: true });
  const write = (path, value) =>
    writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  await write('package.json', { name: 'fixture', version: '1' });
  await write('package-lock.json', {
    packages: {
      '': {},
      'node_modules/vue': {
        version: '3',
        license: 'MIT',
        resolved: 'https://example.invalid/vue.tgz',
        integrity: 'sha512-xxx',
      },
    },
  });
  await write(
    'src-tauri/Cargo.lock',
    '[[package]]\nname = "native"\nversion = "1.0.0"\nsource = "registry+test"\nchecksum = "' +
      'a'.repeat(64) +
      '"\n',
  );
  await write('security/runtime-components.json', {
    components: [
      {
        id: 'node',
        name: 'Node.js',
        type: 'application',
        version: '24',
        url: 'https://example.invalid/node.zip',
        sha256: 'b'.repeat(64),
        license: 'MIT',
      },
      {
        id: 'koffi',
        name: 'koffi',
        type: 'library',
        version: '3.3.2',
        ecosystem: 'npm',
        url: 'https://example.invalid/koffi.tgz',
        sha256: 'c'.repeat(64),
        license: 'MIT',
      },
    ],
  });
  await write('src-tauri/runtime/npm/package.json', {
    name: 'npm',
    version: '11',
    license: 'Artistic-2.0',
  });
  await write('src-tauri/runtime/npm/node_modules/vendor/package.json', {
    name: 'vendor',
    version: '2',
    license: 'MIT',
  });
  const metadata = {
    packages: [
      { name: 'native', version: '1.0.0', source: 'registry+test', license: 'MIT OR Apache-2.0' },
    ],
  };
  const bom = await generateSbom(root, { metadata, archiveHash: async () => 'd'.repeat(64) });
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.ok(
    bom.components.find(
      (c) =>
        c['bom-ref'] === 'runtime:koffi' &&
        c.licenses[0].license.name === 'MIT' &&
        c.hashes[0].content === 'c'.repeat(64),
    ),
  );
  assert.ok(bom.components.find((c) => c['bom-ref'] === 'cargo:native@1.0.0'));
  assert.ok(
    bom.components.find(
      (c) => c.name === 'vendor' && c.properties.some((p) => p.value === 'node-vendored-npm'),
    ),
  );
  assert.ok(
    bom.components.find((c) => c.type === 'file' && c.name.endsWith('vendor/package.json')),
  );
  assert.equal(auditQueries(bom).filter((q) => q.package.name === 'koffi').length, 1);
  await verifyBomInputs(root, bom);
  await write('security/runtime-components.json', { changed: true });
  await assert.rejects(verifyBomInputs(root, bom), /SBOM périmé/);
  await write('security/runtime-components.json', { components: [] });
  assert.ok(auditQueries(bom).find((q) => q.package.ecosystem === 'crates.io'));
  await assert.rejects(
    generateSbom(root, { metadata: { packages: [] }, archiveHash: async () => 'd'.repeat(64) }),
    /sans métadonnées/,
  );
  await assert.rejects(
    npmComponents({ packages: { 'node_modules/bad': { version: '1' } } }, async () => ''),
    /sans source/,
  );
  assert.equal(cargoLockPackages('[[package]]\nname = "a"\nversion = "1"')[0].name, 'a');
});

const catalog = JSON.parse(
  await readFile(new URL('../security/runtime-components.json', import.meta.url)),
);
const bom = {
  components: [
    { name: 'koffi', version: '3.3.2', purl: 'pkg:npm/koffi@3.3.2' },
    { name: 'vendor', version: '1', purl: 'pkg:npm/vendor@1' },
    { name: 'native', version: '1', purl: 'pkg:cargo/native@1' },
  ],
};
const fetched = async (url, opts) => {
  if (url.includes('querybatch')) {
    const q = JSON.parse(opts.body).queries;
    return Response.json({
      results: q.map((x) =>
        x.package.name === 'koffi'
          ? { vulns: [{ id: 'TEST-ADVISORY-ONLY', modified: '2026-01-01' }] }
          : {},
      ),
    });
  }
  if (url.includes('index.json'))
    return Response.json([{ version: 'v24.22.0', security: true, date: '2026-10-18' }]);
  if (url.includes('registry.npmjs.org')) return Response.json({ version: '3.3.3' });
  return Response.json({ sha: 'e'.repeat(40) });
};
test('avis Koffi hors lock et mises à jour Node/Cactus restent des signaux sourcés', async () => {
  const audit = await osvAudit(bom, fetched);
  assert.equal(audit.queried, 3);
  assert.equal(audit.findings[0].package.name, 'koffi');
  assert.match(audit.findings[0].source, /TEST-ADVISORY-ONLY/);
  const monitor = await monitorRuntime(catalog, fetched);
  assert.ok(monitor.find((x) => x.component === 'node').securityReleasesAfterPin.length);
  assert.ok(monitor.find((x) => x.component === 'Cactus-Compute/needle3').updateAvailable);
  assert.match(
    monitor.find((x) => x.component === 'Cactus-Compute/needle3').conclusion,
    /No complete native advisory/,
  );
  await assert.rejects(
    osvAudit(bom, async () => Response.json({ results: [] })),
    /incomplète/,
  );
});
test('une panne de base d’avis n’est jamais un audit vert ; l’observation conserve ses limites', async () => {
  const npmRun = () => ({
    status: 0,
    stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 0 } } }),
  });
  const result = await runAudit(fileURLToPath(new URL('..', import.meta.url)), bom, {
    npmRun,
    fetcher: fetched,
  });
  assert.equal(result.complete, true);
  assert.equal(result.needsReview, true);
  assert.ok(result.limitations.some((x) => /No absence-of-risk/.test(x)));
  const failed = await runAudit(fileURLToPath(new URL('..', import.meta.url)), bom, {
    npmRun: () => ({ status: 1, stdout: '{"error":{"message":"network"}}' }),
    fetcher: async () => new Response('', { status: 503 }),
  });
  assert.equal(failed.complete, false);
  assert.equal(failed.errors.length, 3);
});
