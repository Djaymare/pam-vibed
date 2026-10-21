import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { archiveFiles } from '../scripts/ci-archive.mjs';
import { digest, zipEntries } from '../scripts/runtime-integrity.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pam-ci-archive-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), 'pam-ci-archive-')));
    await rm(root, { recursive: true, force: true });
  });
  const directory = join(root, 'portable');
  await mkdir(join(directory, 'runtime/npm'), { recursive: true });
  const files = {
    'current.json': 'pointer',
    'runtime/npm/.npmrc': 'fixture-only',
    'runtime/npm/readme.txt': 'payload',
  };
  for (const [name, content] of Object.entries(files))
    await writeFile(join(directory, name), content);
  await writeFile(join(directory, '.unlisted-secret'), 'must not be uploaded');
  return {
    directory,
    expected: Object.fromEntries(
      Object.entries(files).map(([name, content]) => [name, digest(Buffer.from(content))]),
    ),
    output: join(root, 'portable.zip'),
  };
}
const windows = { skip: process.platform !== 'win32' };

test(
  'archive preserves hidden manifest files and excludes every unlisted file',
  windows,
  async (t) => {
    const f = await fixture(t);
    const result = await archiveFiles(f.directory, f.expected, f.output);
    const entries = zipEntries(await readFile(f.output));
    assert.equal(entries.get('runtime/npm/.npmrc').toString(), 'fixture-only');
    assert.equal(entries.has('.unlisted-secret'), false);
    assert.equal(result.entries, 3);
  },
);

test(
  'hidden-file filtering is detected before replacing an existing archive',
  windows,
  async (t) => {
    const f = await fixture(t);
    await writeFile(f.output, 'previous-complete-archive');
    const filtered = (program, args, options) =>
      execFileSync(program, args, {
        ...options,
        input: Buffer.from(
          options.input
            .toString()
            .split('\0')
            .filter((name) => name && !name.split('/').some((p) => p.startsWith('.')))
            .join('\0') + '\0',
        ),
      });
    await assert.rejects(
      archiveFiles(f.directory, f.expected, f.output, filtered),
      /inventory differs/,
    );
    assert.equal(await readFile(f.output, 'utf8'), 'previous-complete-archive');
  },
);

test('changed source and traversal fail without publishing an archive', windows, async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'runtime/npm/.npmrc'), 'tampered');
  await assert.rejects(archiveFiles(f.directory, f.expected, f.output), /Changed archive source/);
  await assert.rejects(archiveFiles(f.directory, { '../outside': 'invalid' }, f.output), /Chemin/);
  await assert.rejects(readFile(f.output), /ENOENT/);
});
