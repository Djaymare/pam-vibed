import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, cp, stat, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, 'src-tauri/runtime');
const binaries = join(root, 'src-tauri/binaries');
const cache = join(root, '.runtime-cache');
const nodeVersion = '24.21.0';
const needleRevision = 'c7c415a3d1b3d929014bc6e866d51ebb971f7089';
const whistleRevision = 'b358ddadd89b7a713b5aa131f23032d3cca1b251';

async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function download(url, destination, sha256) {
  await mkdir(dirname(destination), { recursive: true });
  try { if (await hash(destination) === sha256) return; } catch {}
  console.log(`Téléchargement : ${destination.slice(root.length + 1)}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`${response.status} : ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new Error(`Empreinte SHA-256 incorrecte : ${url}`);
  }
  await writeFile(`${destination}.partial`, bytes);
  await rename(`${destination}.partial`, destination);
}

async function extractZip(archivePath, destination) {
  // ZIP extraction with Node built-ins, so the Docker build also needs no
  // PowerShell, unzip, Python, or additional npm dependency.
  const bytes = await readFile(archivePath);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw new Error('Archive ZIP invalide.');
  const entries = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < entries; index++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Répertoire ZIP invalide.');
    const compression = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const originalSize = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28);
    const extraSize = bytes.readUInt16LE(offset + 30);
    const commentSize = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameSize);
    const file = resolve(destination, name);
    if (!file.startsWith(resolve(destination) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Chemin ZIP hors du cache.');
    if (name.endsWith('/')) await mkdir(file, { recursive: true });
    else {
      if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Entrée ZIP invalide.');
      const start = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
      const compressed = bytes.subarray(start, start + compressedSize);
      const content = compression === 0 ? compressed : compression === 8 ? inflateRawSync(compressed) : null;
      if (!content || content.length !== originalSize) throw new Error('Compression ZIP invalide.');
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    offset += 46 + nameSize + extraSize + commentSize;
  }
}

async function extractTar(archivePath, destination) {
  const bytes = gunzipSync(await readFile(archivePath));
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString().split('\0')[0];
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8) || 0;
    const type = header[156];
    if (type === 0 || type === 48) {
      if (!name.startsWith('package/')) throw new Error('Archive npm invalide.');
      const file = resolve(destination, name.slice(8));
      if (!file.startsWith(resolve(destination) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Chemin npm hors du runtime.');
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

await mkdir(cache, { recursive: true });
await mkdir(binaries, { recursive: true });
const archive = join(cache, `node-v${nodeVersion}-win-x64.zip`);
await download(`https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-x64.zip`, archive,
  '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541');
const extracted = join(cache, `node-v${nodeVersion}-win-x64`);
try { await stat(join(extracted, 'node.exe')); } catch {
  await extractZip(archive, cache);
}
if (await hash(join(extracted, 'node.exe')) !== 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32') {
  throw new Error('Empreinte du Node extrait incorrecte.');
}
const nodeDestination = join(binaries, 'pam-node-x86_64-pc-windows-msvc.exe');
let nodeCurrent = false;
try { nodeCurrent = await hash(nodeDestination) === await hash(join(extracted, 'node.exe')); } catch {}
if (!nodeCurrent) await copyFile(join(extracted, 'node.exe'), nodeDestination);
await mkdir(join(runtime, 'npm'), { recursive: true });
await cp(join(extracted, 'node_modules/npm'), join(runtime, 'npm'), { recursive: true });
await copyFile(join(extracted, 'LICENSE'), join(runtime, 'NODE-LICENSE.txt'));

const assets = [
  { file: 'needle.exe', repo: 'needle3', revision: needleRevision, source: 'windows-x86_64/needle.exe',
    sha256: 'c70ca998f6c542c862c06c22352046e303ef5c769384069ee25cef9f4667e4cf' },
  { file: 'models/needle3.cact', repo: 'needle3', revision: needleRevision, source: 'needle3.cact',
    sha256: 'c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38' },
  { file: 'models/whistle.cact', repo: 'whistle', revision: whistleRevision, source: 'whistle.cact',
    sha256: 'b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb' },
];
for (const asset of assets) {
  await download(`https://huggingface.co/Cactus-Compute/${asset.repo}/resolve/${asset.revision}/${asset.source}`,
    join(runtime, asset.file), asset.sha256);
}
// Extract the official native DLL from its wheel; Python is never installed or run.
const wheel = join(cache, 'needle-wheel.zip');
await download(`https://huggingface.co/Cactus-Compute/needle3/resolve/${needleRevision}/python/cactus_needle-3.1.0-py3-none-win_amd64.whl`, wheel,
  '4f5fc86abfc50d551cdb237a34b501f36d82d4b6f5911ee7bec4e9532d44dd95');
await extractZip(wheel, join(cache, 'needle-wheel'));
await copyFile(join(cache, 'needle-wheel/needle/libneedle3.dll'), join(runtime, 'libneedle3.dll'));
for (const pkg of [
  { name: 'koffi', destination: 'koffi', sha256: '1c5189a71bab92a3b429e82456d10254ce1a1528a1c49f87f4e93ce944426cb0', url: 'https://registry.npmjs.org/koffi/-/koffi-3.3.2.tgz' },
  { name: 'koffi-win32-x64', destination: '@koromix/koffi-win32-x64', sha256: 'b6cf9c8c871008e5b51cb5e5633de6d1758e48dad9795b0eb9e9b44f0a778937', url: 'https://registry.npmjs.org/@koromix/koffi-win32-x64/-/koffi-win32-x64-3.3.2.tgz' },
]) {
  const archivePath = join(cache, `${pkg.name}-3.3.2.tgz`);
  await download(pkg.url, archivePath, pkg.sha256);
  await extractTar(archivePath, join(runtime, 'ffi/node_modules', pkg.destination));
}
for (const file of ['libneedle3.dll', 'ffi/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node']) {
  assets.push({ file, sha256: await hash(join(runtime, file)) });
}
for (const [repo, revision] of [['needle3', needleRevision], ['whistle', whistleRevision]]) {
  const response = await fetch(`https://huggingface.co/Cactus-Compute/${repo}/resolve/${revision}/LICENSE`);
  if (!response.ok) throw new Error(`Licence ${repo} introuvable`);
  await writeFile(join(runtime, `${repo.toUpperCase()}-LICENSE.txt`), await response.text());
}
const npmVersion = JSON.parse(await readFile(join(runtime, 'npm/package.json'), 'utf8')).version;
await writeFile(join(runtime, 'manifest.json'), JSON.stringify({
  target: 'x86_64-pc-windows-msvc', node: nodeVersion, npm: npmVersion,
  nodeSha256: await hash(join(binaries, 'pam-node-x86_64-pc-windows-msvc.exe')),
  needleRevision, whistleRevision, ffi: 'koffi 3.3.2', assets,
}, null, 2));
console.log(`Runtime Windows x64 prêt : Node ${nodeVersion}, npm ${npmVersion}, Needle et Whistle.`);
