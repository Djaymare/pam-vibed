// Build identical read-only helpers against a Git baseline or current sources.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
const revision = process.argv[2];
assert.ok(revision, 'Pass a Git revision or workspace');
const root = resolve(import.meta.dirname, '..');
const cache = join(root, '.runtime-cache');
await mkdir(cache, { recursive: true });
const directory = await mkdtemp(join(cache, 'discovery-benchmark-'));
const sourceHashes = {};
const commit =
  revision === 'workspace'
    ? null
    : execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
for (const file of [
  'applications.rs',
  'applications/native.rs',
  'applications/tests.rs',
  'windows_resources.rs',
]) {
  const path = `src-tauri/src/${file}`;
  const bytes = commit
    ? execFileSync('git', ['show', `${commit}:${path}`], { cwd: root })
    : await readFile(join(root, path));
  const output = join(directory, 'src', file);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
  sourceHashes[path] = createHash('sha256').update(bytes).digest('hex');
}
for (const name of ['discovery', 'discovery-performance']) {
  const file = `src-tauri/examples/${name}.rs`;
  const bytes = await readFile(join(root, file), 'utf8');
  await writeFile(join(directory, 'src', `${name}.rs`), bytes.replaceAll('../src/', './'));
  sourceHashes[file] = createHash('sha256').update(bytes).digest('hex');
}
await writeFile(
  join(directory, 'Cargo.toml'),
  `[package]
name = "pam-discovery-benchmark"
version = "0.1.0"
edition = "2021"
rust-version = "1.99"
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
base64 = "0.22"
png = "0.18"
windows = { version = "0.62", features = ["Win32_Foundation", "Win32_System_Com", "Win32_System_WinRT", "Win32_System_SystemInformation", "Win32_UI_Shell", "Win32_UI_Shell_PropertiesSystem", "Win32_Graphics_Gdi", "Win32_System_ProcessStatus", "Win32_System_Threading"] }
[[bin]]
name = "discovery"
path = "src/discovery.rs"
[[bin]]
name = "discovery-performance"
path = "src/discovery-performance.rs"
`,
);
await copyFile(
  join(root, 'tests/fixtures/discovery-benchmark.Cargo.lock'),
  join(directory, 'Cargo.lock'),
);
const metadata = {
  revision,
  commit,
  directory,
  manifest: join(directory, 'Cargo.toml'),
  sourceHashes,
};
await writeFile(join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify(metadata));
