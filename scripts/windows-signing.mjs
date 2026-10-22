import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function certificateThumbprint(value) {
  assert.match(value ?? '', /^[a-fA-F0-9]{40}$/, 'Empreinte SHA-1 du certificat requise (40 hex)');
  return value.toUpperCase();
}

export function signingConfiguration(env) {
  const thumbprint = certificateThumbprint(env.PAM_SIGNING_THUMBPRINT);
  const timestamp = new URL(env.PAM_SIGNING_TIMESTAMP_URL);
  assert.equal(timestamp.protocol, 'https:', 'Serveur RFC 3161 HTTPS requis');
  assert.ok(
    !timestamp.username && !timestamp.password && !timestamp.hash,
    'URL sans identifiants ni fragment requise',
  );
  return {
    bundle: {
      windows: {
        certificateThumbprint: thumbprint,
        digestAlgorithm: 'sha256',
        timestampUrl: timestamp.href,
        tsp: true,
      },
    },
  };
}

export function signatureInvocation(file, sha256, thumbprint, env) {
  assert.ok(isAbsolute(file), 'Chemin absolu du fichier requis');
  assert.match(sha256 ?? '', /^[a-fA-F0-9]{64}$/, 'SHA-256 attendu requis (64 hex)');
  assert.ok(isAbsolute(env.PAM_SIGNTOOL_PATH ?? ''), 'PAM_SIGNTOOL_PATH absolu requis');
  assert.ok(isAbsolute(env.SystemRoot ?? ''), 'SystemRoot absolu requis');
  const powershell =
    env.PAM_POWERSHELL_PATH ||
    resolve(env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  assert.ok(isAbsolute(powershell), 'PAM_POWERSHELL_PATH absolu requis');
  return {
    program: powershell,
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      resolve(root, 'scripts/verify-windows-signature.ps1'),
      '-FilePath',
      file,
      '-ExpectedSha256',
      sha256.toLowerCase(),
      '-ExpectedThumbprint',
      certificateThumbprint(thumbprint),
      '-SignToolPath',
      env.PAM_SIGNTOOL_PATH,
    ],
  };
}

export async function verifyWindowsSignature(file, sha256, thumbprint, env = process.env) {
  assert.equal(process.platform, 'win32', 'Vérification Authenticode Windows requise');
  const call = signatureInvocation(file, sha256, thumbprint, env);
  const { stdout } = await run(call.program, call.args, {
    windowsHide: true,
    shell: false,
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
    env,
  });
  const evidence = JSON.parse(stdout.replace(/^\uFEFF/, ''));
  assert.equal(evidence.status, 'Valid');
  assert.equal(evidence.sha256, sha256.toLowerCase());
  assert.equal(evidence.thumbprint, certificateThumbprint(thumbprint));
  assert.equal(evidence.timestamped, true);
  assert.equal(evidence.signtoolExitCode, 0);
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'config') {
      assert.equal(args.length, 0, 'config ne prend pas de chemin de sortie');
      const config = signingConfiguration(process.env);
      const path = resolve(root, 'artifacts/release/tauri.signing.json');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(config, null, 2) + '\n');
      console.log(`Configuration de signature préparée : ${path}`);
    } else if (command === 'verify') {
      assert.equal(
        args.length,
        3,
        'verify <chemin absolu> <SHA-256 attendu> <empreinte certificat>',
      );
      console.log(JSON.stringify(await verifyWindowsSignature(...args), null, 2));
    } else {
      throw new Error('Commande attendue : config ou verify');
    }
  } catch (error) {
    console.error(error.message);
    if (error.stderr) console.error(error.stderr);
    process.exitCode = 1;
  }
}
