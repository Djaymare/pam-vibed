// Preserve the complete manifest inventory inside one non-hidden upload file.
import assert from 'node:assert/strict';
import { readFile, writeFile, rename, rm, lstat, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { safePath, resolvePortable, verifyPortable } from './portable-integrity.mjs';
import { hash, digest, zipEntries } from './runtime-integrity.mjs';

export async function archiveFiles(directory, expected, output, runner = execFileSync) {
  assert.equal(process.platform, 'win32', 'The distribution archive uses Windows inbox bsdtar');
  const root = await realpath(directory);
  const names = Object.keys(expected).sort();
  assert.ok(names.length > 0);
  for (const name of names) {
    const source = safePath(root, name);
    const actual = await realpath(source);
    const rel = relative(root, actual);
    assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Archive source outside portable');
    assert.ok((await lstat(source)).isFile(), 'Regular archive source required');
    assert.equal(await hash(source), expected[name], `Changed archive source: ${name}`);
  }
  const stage = `${resolve(output)}.${randomUUID()}.zip`;
  try {
    runner(
      join(process.env.SystemRoot || 'C:/Windows', 'System32/tar.exe'),
      ['-a', '-c', '-f', stage, '-C', root, '--null', '-T', '-'],
      { input: Buffer.from(names.join('\0') + '\0'), windowsHide: true, timeout: 10 * 60_000 },
    );
    const entries = zipEntries(await readFile(stage));
    assert.deepEqual([...entries.keys()].sort(), names, 'Archive inventory differs from manifest');
    for (const [name, bytes] of entries)
      assert.equal(digest(bytes), expected[name], `Archive digest mismatch: ${name}`);
    const sha256 = await hash(stage);
    await rename(stage, output);
    return { sha256, entries: names.length };
  } finally {
    await rm(stage, { force: true });
  }
}

export async function archivePortable(root) {
  const store = join(root, 'artifacts/PAM-windows-x64');
  const bundle = await resolvePortable(store);
  const distribution = await verifyPortable(bundle);
  const prefix = relative(store, bundle).replaceAll('\\', '/');
  const pointer = JSON.parse(await readFile(join(store, 'current.json'), 'utf8'));
  assert.equal(pointer.release, prefix);
  assert.equal(pointer.manifestSha256, await hash(join(bundle, 'distribution.json')));
  const expected = {
    'current.json': await hash(join(store, 'current.json')),
    [`${prefix}/distribution.json`]: pointer.manifestSha256,
    ...Object.fromEntries(
      Object.entries(distribution.files).map(([name, sha]) => [`${prefix}/${name}`, sha]),
    ),
  };
  const deliveryPath = join(root, 'artifacts/ci/delivery.json');
  const delivery = JSON.parse(await readFile(deliveryPath, 'utf8'));
  assert.equal(delivery.commit, distribution.identity.commit);
  assert.equal(delivery.portableManifestSha256, pointer.manifestSha256);
  const file = 'PAM-windows-x64.zip';
  const result = await archiveFiles(store, expected, join(root, 'artifacts', file));
  delivery.portableArchive = { file, ...result };
  await writeFile(deliveryPath, JSON.stringify(delivery, null, 2) + '\n');
  return delivery.portableArchive;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(
    JSON.stringify(await archivePortable(fileURLToPath(new URL('..', import.meta.url))), null, 2),
  );
