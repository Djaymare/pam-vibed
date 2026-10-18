import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { digest, hash, treeFiles, loadCatalog } from './runtime-integrity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const prop = (name, value) => ({ name: `pam:${name}`, value: String(value) });
const license = (name) => [
  { license: { name: name || 'NOASSERTION — upstream metadata missing; review required' } },
];
const purl = (type, name, version) =>
  `pkg:${type}/${name.startsWith('@') ? name.replace('@', '%40') : name}@${version}`;

export function cargoLockPackages(text) {
  return text
    .split(/\[\[package\]\]/)
    .slice(1)
    .map((block) =>
      Object.fromEntries(
        [...block.matchAll(/^(name|version|source|checksum) = "([^"]+)"/gm)].map((m) => [
          m[1],
          m[2],
        ]),
      ),
    );
}

export async function npmComponents(lock, archiveHash, scope) {
  const components = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    const name = entry.name || path.split('node_modules/').at(-1);
    if (!entry.resolved || !entry.integrity)
      throw new Error(`Archive npm sans source/empreinte : ${path}`);
    const sha256 = await archiveHash(entry);
    components.push({
      type: 'library',
      name,
      version: entry.version,
      'bom-ref': `${scope}:${path}`,
      purl: purl('npm', name, entry.version),
      hashes: [{ alg: 'SHA-256', content: sha256 }],
      licenses: license(entry.license),
      externalReferences: [{ type: 'distribution', url: entry.resolved }],
      properties: [
        prop('scope', scope),
        prop('lock-path', path),
        prop('integrity', entry.integrity),
        prop('hash-kind', 'verified upstream archive'),
        prop('dev', !!entry.dev),
        prop('optional', !!entry.optional),
      ],
    });
  }
  return components;
}

async function npmArchiveHash(entry) {
  const path = join(root, '.runtime-cache/sbom-npm', digest(Buffer.from(entry.resolved)) + '.tgz');
  await mkdir(dirname(path), { recursive: true });
  const sri = entry.integrity.split(' ').find((v) => /^(sha512|sha256|sha1)-/.test(v));
  if (!sri) throw new Error('Intégrité npm non prise en charge.');
  const split = sri.indexOf('-'),
    algorithm = sri.slice(0, split),
    expected = sri.slice(split + 1);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {}
  if (!bytes || createHash(algorithm).update(bytes).digest('base64') !== expected) {
    const response = await fetch(entry.resolved, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Archive npm ${response.status} : ${entry.resolved}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash(algorithm).update(bytes).digest('base64') !== expected)
      throw new Error(`Intégrité npm incorrecte : ${entry.resolved}`);
    await writeFile(path, bytes); // Validated bytes only; rechecked even on cache hits.
  }
  return digest(bytes);
}

export async function generateSbom(projectRoot, { metadata, archiveHash = npmArchiveHash } = {}) {
  const catalog = await loadCatalog(projectRoot),
    lock = await json(join(projectRoot, 'package-lock.json'));
  const components = await npmComponents(lock, archiveHash, 'root-npm-lock');
  const cargo = cargoLockPackages(
    await readFile(join(projectRoot, 'src-tauri/Cargo.lock'), 'utf8'),
  );
  if (!metadata) {
    const r = spawnSync(
      process.env.CARGO || 'cargo',
      [
        'metadata',
        '--manifest-path',
        join(projectRoot, 'src-tauri/Cargo.toml'),
        '--locked',
        '--format-version',
        '1',
      ],
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, windowsHide: true },
    );
    if (r.error || r.status !== 0)
      throw new Error(`cargo metadata échoué : ${r.error?.message || r.stderr}`);
    metadata = JSON.parse(r.stdout);
  }
  for (const c of cargo) {
    if (!c.source) continue;
    const m = metadata.packages.find(
      (p) => p.name === c.name && p.version === c.version && p.source === c.source,
    );
    if (!m || !c.checksum)
      throw new Error(`Crate sans métadonnées/checksum : ${c.name} ${c.version}`);
    components.push({
      type: 'library',
      name: c.name,
      version: c.version,
      'bom-ref': `cargo:${c.name}@${c.version}`,
      purl: purl('cargo', c.name, c.version),
      hashes: [{ alg: 'SHA-256', content: c.checksum }],
      licenses: license(m.license),
      externalReferences: [
        {
          type: 'distribution',
          url: `https://crates.io/api/v1/crates/${c.name}/${c.version}/download`,
        },
        ...(m.repository ? [{ type: 'vcs', url: m.repository }] : []),
      ],
      properties: [
        prop('scope', 'cargo-lock-all-targets'),
        prop('source', c.source),
        prop('hash-kind', 'Cargo.lock registry archive checksum'),
      ],
    });
  }
  for (const c of catalog.components)
    components.push({
      type: c.type,
      name: c.name,
      version: c.version,
      'bom-ref': `runtime:${c.id}`,
      ...(c.ecosystem ? { purl: purl(c.ecosystem, c.name, c.version) } : {}),
      hashes: [{ alg: 'SHA-256', content: c.sha256 }],
      licenses: license(c.license),
      externalReferences: [
        { type: 'distribution', url: c.url },
        {
          type: 'advisories',
          url:
            c.security ||
            (c.repo
              ? 'https://github.com/cactus-compute/cactus/security'
              : 'https://github.com/Koromix/koffi/security'),
        },
      ],
      properties: [
        prop('scope', 'downloaded-runtime'),
        prop('hash-kind', 'pinned upstream archive or standalone artifact'),
        ...(c.revision ? [prop('revision', c.revision)] : []),
        ...(c.nodeSha256 || c.fileSha256
          ? [prop('extracted-artifact-sha256', c.nodeSha256 || c.fileSha256)]
          : []),
      ],
    });
  // Node's vendored npm and its transitive packages are absent from the root lock.
  const runtimeRoot = join(projectRoot, 'src-tauri/runtime');
  const nodePin = catalog.components.find((c) => c.id === 'node');
  if (nodePin.nodeSha256) {
    const nodeFile = 'src-tauri/binaries/pam-node-x86_64-pc-windows-msvc.exe';
    if ((await hash(join(projectRoot, nodeFile))) !== nodePin.nodeSha256)
      throw new Error('Node embarqué ne correspond pas au catalogue.');
    components.push({
      type: 'file',
      name: nodeFile,
      'bom-ref': 'file:embedded-node',
      hashes: [{ alg: 'SHA-256', content: nodePin.nodeSha256 }],
      properties: [prop('scope', 'shipped-node-executable')],
    });
  }
  const files = (await treeFiles(runtimeRoot)).filter(
    (p) => p !== 'manifest.json' && p !== 'sbom.cdx.json',
  );
  const hashes = new Map();
  for (const file of files) hashes.set(file, await hash(join(runtimeRoot, file)));
  for (const file of files.filter((p) => p.startsWith('npm/') && p.endsWith('/package.json'))) {
    const m = await json(join(runtimeRoot, file));
    if (!m.name || !m.version) continue;
    const dir = file.slice(0, -'package.json'.length);
    // package.json evidence hash is distinct from the archive hashes above.
    const licenseName =
      typeof m.license === 'string'
        ? m.license
        : m.license?.type ||
          m.licenses?.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ');
    components.push({
      type: 'library',
      name: m.name,
      version: m.version,
      'bom-ref': `vendored:${file}`,
      purl: purl('npm', m.name, m.version),
      licenses: license(licenseName),
      hashes: [{ alg: 'SHA-256', content: hashes.get(file) }],
      externalReferences: [
        { type: 'distribution', url: catalog.components.find((c) => c.id === 'node').url },
      ],
      properties: [
        prop('scope', 'node-vendored-npm'),
        prop('path', dir),
        prop('hash-kind', 'package.json; all package files separately inventoried'),
      ],
    });
  }
  for (const [path, sha256] of hashes)
    components.push({
      type: 'file',
      name: path,
      'bom-ref': `file:runtime/${path}`,
      hashes: [{ alg: 'SHA-256', content: sha256 }],
      properties: [prop('scope', 'shipped-runtime-file')],
    });
  const pkg = await json(join(projectRoot, 'package.json'));
  const sourceHashes = [];
  for (const path of [
    'package-lock.json',
    'src-tauri/Cargo.lock',
    'security/runtime-components.json',
  ])
    sourceHashes.push(prop(`input-sha256:${path}`, await hash(join(projectRoot, path))));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: { type: 'application', name: pkg.name, version: pkg.version },
      properties: [
        ...sourceHashes,
        prop(
          'scope',
          'root npm all optional/dev platforms; Cargo.lock all targets; downloaded Windows runtime; vendored npm; runtime files',
        ),
        prop(
          'limitations',
          'Inventory is not an advisory verdict. OS/WebView2 and compiler/system libraries are external. Native transitive libraries without upstream SBOM remain a documented evidence gap.',
        ),
      ],
    },
    components,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const metadataPath = process.env.PAM_CARGO_METADATA;
    const bom = await generateSbom(root, {
      metadata: metadataPath ? await json(resolve(metadataPath)) : undefined,
    });
    const output = resolve(process.argv[2] || join(root, 'artifacts/security/sbom.cdx.json'));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(bom, null, 2) + '\n');
    console.log(`SBOM : ${bom.components.length} composants/fichiers, ${output}`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
