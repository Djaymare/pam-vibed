// Model-free Windows test prerequisite: only the pinned Node executable.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
assert.equal(process.platform, 'win32', 'Native tests require Windows');
assert.equal(process.versions.node, '24.21.0', 'Use the repository-pinned Node version');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bytes = await readFile(process.execPath);
assert.equal(createHash('sha256').update(bytes).digest('hex'), 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32', 'Use the official Node Windows x64 executable');
const binaries = join(root, 'src-tauri/binaries');
await mkdir(binaries, { recursive: true });
// Tauri's configured resource directory must exist, even without assets.
await mkdir(join(root, 'src-tauri/runtime'), { recursive: true });
const target = join(binaries, 'pam-node-x86_64-pc-windows-msvc.exe');
if (resolve(process.execPath).toLowerCase() !== resolve(target).toLowerCase()) await copyFile(process.execPath, target);
console.log('Native tests prepared: pinned Node only; no models downloaded.');
