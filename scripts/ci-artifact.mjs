// Bind the final package and the validation report to the checked-out commit.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePortable, verifyPortable, git } from './portable-integrity.mjs';
import { hash, treeFiles } from './runtime-integrity.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const commit = git(root, 'rev-parse', 'HEAD');
const integration = JSON.parse(
  await readFile(join(root, 'artifacts/ci/integration/report.json'), 'utf8'),
);
assert.equal(integration.outcome, 'passed', 'Real integrations must succeed');
assert.equal(integration.commit, commit, 'Integration evidence belongs to a different commit');
assert.equal(integration.workingTreeClean, true, 'Integration must test committed sources');
if (process.env.GITHUB_SHA)
  assert.equal(process.env.GITHUB_SHA, commit, 'Checkout must match the workflow commit');
const bundle = await resolvePortable(join(root, 'artifacts/PAM-windows-x64'));
const distribution = await verifyPortable(bundle);
assert.equal(distribution.identity.commit, commit, 'Package belongs to a different commit');
const nsisRoot = join(
  resolve(root, process.env.CARGO_TARGET_DIR || 'src-tauri/target'),
  'x86_64-pc-windows-msvc/release/bundle/nsis',
);
const installers = (await treeFiles(nsisRoot)).filter((p) => p.endsWith('setup.exe'));
assert.equal(installers.length, 1, 'Exactly one fresh NSIS installer is required');
const evidence = {
  schemaVersion: 1,
  commit,
  buildId: distribution.identity.buildId,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  sourceCommit: process.env.GITHUB_SHA || commit,
  portableManifestSha256: await hash(join(bundle, 'distribution.json')),
  installer: { file: installers[0], sha256: await hash(join(nsisRoot, installers[0])) },
  integrationReportSha256: await hash(join(root, 'artifacts/ci/integration/report.json')),
  verifiedAt: new Date().toISOString(),
};
await writeFile(join(root, 'artifacts/ci/delivery.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
