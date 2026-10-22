import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  certificateThumbprint,
  signingConfiguration,
  signatureInvocation,
  verifyWindowsSignature,
} from '../scripts/windows-signing.mjs';

const thumbprint = 'a'.repeat(40);
const env = {
  PAM_SIGNING_THUMBPRINT: thumbprint,
  PAM_SIGNING_TIMESTAMP_URL: 'https://timestamp.example.invalid/rfc3161',
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('configuration Tauri : certificat explicite, SHA-256 et RFC3161, aucun secret copie', () => {
  const config = signingConfiguration({
    ...env,
    PFX_PASSWORD: 'must-not-leak',
    PFX: 'must-not-leak',
  });
  assert.deepEqual(config, {
    bundle: {
      windows: {
        certificateThumbprint: thumbprint.toUpperCase(),
        digestAlgorithm: 'sha256',
        timestampUrl: env.PAM_SIGNING_TIMESTAMP_URL,
        tsp: true,
      },
    },
  });
  const schema = JSON.parse(
    readFileSync(
      new URL('../node_modules/@tauri-apps/cli/config.schema.json', import.meta.url),
      'utf8',
    ),
  );
  const windows = schema.definitions.WindowsConfig.properties;
  for (const key of Object.keys(config.bundle.windows)) assert.ok(key in windows);
});

test('configuration refuse certificat absent/malforme et serveur non HTTPS ou avec identifiants', () => {
  for (const value of [
    undefined,
    '',
    'aa',
    'a'.repeat(40) + ' ',
    'x'.repeat(40),
    '$(' + thumbprint + ')',
  ]) {
    assert.throws(() => certificateThumbprint(value));
  }
  for (const url of [
    undefined,
    '',
    'http://timestamp.invalid',
    'https://user:secret@timestamp.invalid',
    'https://timestamp.invalid/#secret',
  ]) {
    assert.throws(() => signingConfiguration({ ...env, PAM_SIGNING_TIMESTAMP_URL: url }));
  }
  assert.throws(() => signingConfiguration({}));
});

test('verification : chemins et empreintes explicites, espaces et metacaracteres restent des arguments', () => {
  const file = resolve('a space', 'a[1]$(no-command).exe');
  const native = {
    SystemRoot: resolve('Windows'),
    PAM_SIGNTOOL_PATH: resolve('Windows SDK', 'signtool.exe'),
  };
  const invocation = signatureInvocation(file, 'b'.repeat(64), thumbprint, native);
  assert.ok(invocation.args.includes(file));
  assert.ok(invocation.args.includes(native.PAM_SIGNTOOL_PATH));
  assert.equal(invocation.args.includes('-Command'), false);
  for (const [path, hash, thumb, environment] of [
    ['relative.exe', 'b'.repeat(64), thumbprint, native],
    [file, 'b'.repeat(63), thumbprint, native],
    [file, 'b'.repeat(64), 'wrong', native],
    [file, 'b'.repeat(64), thumbprint, { ...native, PAM_SIGNTOOL_PATH: 'signtool.exe' }],
  ])
    assert.throws(() => signatureInvocation(path, hash, thumb, environment));
});

test(
  'Windows natif : fichier non signe et hash incorrect refuses sans execution du fichier',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'pam-signature-'));
    t.after(async () => {
      assert.equal(dirname(directory), resolve(tmpdir()));
      await rm(directory, { recursive: true, force: true });
    });
    const file = join(directory, 'unsigned [1] $().exe');
    const bytes = Buffer.from('MZ: unsigned test fixture, never executed');
    await writeFile(file, bytes);
    const native = {
      ...process.env,
      PAM_SIGNTOOL_PATH: process.env.PAM_SIGNTOOL_PATH || process.execPath,
    };
    await assert.rejects(
      verifyWindowsSignature(file, '0'.repeat(64), thumbprint, native),
      (error) => /SHA-256 different/.test(error.stderr),
    );
    await assert.rejects(verifyWindowsSignature(file, digest(bytes), thumbprint, native), (error) =>
      /Signature invalide :/.test(error.stderr),
    );
    assert.deepEqual(await readFile(file), bytes);
  },
);
