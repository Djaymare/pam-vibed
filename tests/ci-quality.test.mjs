import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkflows } from '../scripts/check-workflows.mjs';
import { validateQualityWorkflow } from '../scripts/ci-policy.mjs';
import { checksFor, runChecks } from '../scripts/ci-run.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const workflow = (await readWorkflows(root)).find((w) => w.name === 'windows.yml').workflow;

test('production jobs gate packaging on quick, Windows and Linux checks', () => {
  assert.deepEqual(validateQualityWorkflow(workflow), []);
  const runs = (phase) =>
    checksFor(phase, 'npm-cli.js')
      .map((c) => c.args.join(' '))
      .join('\n');
  for (const command of ['format:check', 'lint', 'test:components', 'build'])
    assert.ok(runs('quick').includes(command));
  assert.ok(runs('quick').includes('npm-cli.js test'));
  for (const command of [
    'fmt --manifest-path src-tauri/Cargo.toml --check',
    'clippy',
    '--all-targets -- -D warnings',
    '--locked',
    'test:webview',
    'test:webview:cleanup',
  ])
    assert.ok(runs('native').includes(command));
  for (const command of [
    'engine-integration',
    'test:integration:node',
    'test:integration',
    'test:confidence',
    'test:deezer:routing',
    'test:media:commands',
  ])
    assert.ok(runs('integration').includes(command));
  assert.match(
    runs('package'),
    /package:windows[\s\S]*package:portable[\s\S]*verify:bundle[\s\S]*ci-artifact/,
  );
  for (const phase of ['quick', 'native', 'integration', 'package'])
    assert.ok(checksFor(phase, 'npm').every((c) => c.timeoutMs > 0 && c.timeoutMs <= 30 * 60_000));
});

const mutations = [
  [
    'Linux pipeline without pipefail',
    (w) => {
      w.jobs.linux.steps.find((s) => s.run?.includes('docker build')).shell = 'sh';
    },
  ],
  ['missing Rust prerequisite', (w) => w.jobs.build.needs.splice(1, 1)],
  ['missing Linux prerequisite', (w) => w.jobs.build.needs.pop()],
  ['native checks start without quick', (w) => delete w.jobs['native-tests'].needs],
  ['ignored quick failure', (w) => (w.jobs.quick['continue-on-error'] = true)],
  ['job bypasses failure', (w) => (w.jobs.build.if = 'always()')],
  [
    'conditional UI checks',
    (w) => (w.jobs['native-tests'].steps.find((s) => s.run === 'npm run ci:native').if = 'false'),
  ],
  [
    'ignored integration failure',
    (w) =>
      (w.jobs.build.steps.find((s) => s.run === 'npm run ci:integration')['continue-on-error'] =
        true),
  ],
  [
    'missing final bundle verification',
    (w) => (w.jobs.build.steps = w.jobs.build.steps.filter((s) => s.run !== 'npm run ci:package')),
  ],
  [
    'unconditional package upload',
    (w) => (w.jobs.build.steps.find((s) => s.with?.name?.startsWith('PAM-ci-')).if = 'always()'),
  ],
  [
    'package before verification',
    (w) => {
      const s = w.jobs.build.steps;
      const i = s.findIndex((s) => s.run === 'npm run ci:package');
      [s[i], s[i + 1]] = [s[i + 1], s[i]];
    },
  ],
  ['lost diagnostics', (w) => w.jobs.quick.steps.pop()],
  [
    'package smuggled into diagnostics',
    (w) => (w.jobs.quick.steps.at(-1).with.path += 'artifacts/PAM-windows-x64/\n'),
  ],
  [
    'artifact without commit',
    (w) =>
      (w.jobs.build.steps.find((s) => s.with?.name?.startsWith('PAM-ci-')).with.name = 'arbitrary'),
  ],
];
for (const [name, change] of mutations)
  test(`quality policy refuses ${name}`, () => {
    const w = structuredClone(workflow);
    change(w);
    assert.ok(validateQualityWorkflow(w).length > 0);
  });

async function directory(t) {
  const p = await mkdtemp(join(tmpdir(), 'pam-ci-runner-'));
  t.after(() => rm(p, { recursive: true, force: true }));
  return p;
}
const command = (code, timeoutMs = 5000) => ({
  program: process.execPath,
  args: ['-e', code],
  timeoutMs,
});
test('a failed check keeps stdout/stderr and prevents all following effects', async (t) => {
  const p = await directory(t);
  const report = await runChecks(
    [
      command("console.log('fixture stdout');console.error('fixture stderr');process.exit(7)"),
      command("throw Error('must not run')"),
    ],
    { directory: p, echo: false, identity: { commit: 'fixture' } },
  );
  assert.equal(report.outcome, 'failed');
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0].exitCode, 7);
  assert.match(await readFile(join(p, '01.log'), 'utf8'), /fixture stdout[\s\S]*fixture stderr/);
  assert.equal(JSON.parse(await readFile(join(p, 'report.json'), 'utf8')).commit, 'fixture');
});
test('timeout terminates only its disposable command and records failure', async (t) => {
  const p = await directory(t);
  const report = await runChecks(
    [command('console.log(process.pid);setInterval(()=>{},1000)', 1500)],
    { directory: p, echo: false },
  );
  assert.equal(report.outcome, 'failed');
  assert.equal(report.checks[0].timedOut, true);
  const pid = Number((await readFile(join(p, '01.log'), 'utf8')).trim());
  assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
test('spawn failure is a recorded failed check, never success', async (t) => {
  const p = await directory(t);
  const report = await runChecks(
    [{ program: join(p, 'missing-program'), args: [], timeoutMs: 2000 }],
    { directory: p, echo: false },
  );
  assert.equal(report.outcome, 'failed');
  assert.match(report.checks[0].error, /ENOENT/);
  assert.equal(JSON.parse(await readFile(join(p, 'report.json'), 'utf8')).outcome, 'failed');
});
test('a successful run records every command', async (t) => {
  const p = await directory(t);
  const report = await runChecks([command('process.exit(0)'), command("console.log('passed')")], {
    directory: p,
    echo: false,
  });
  assert.equal(report.outcome, 'passed');
  assert.equal(report.checks.length, 2);
  assert.ok(report.checks.every((c) => c.passed));
});
