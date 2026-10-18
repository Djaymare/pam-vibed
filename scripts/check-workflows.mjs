import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

export const concurrencyGroup =
  '${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}';
export const trustedCache =
  "github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/master')";

export function parseWorkflow(source) {
  const doc = parseDocument(source, { uniqueKeys: true, stringKeys: true });
  if (doc.errors.length) throw new Error(doc.errors.map((e) => e.message).join('\n'));
  return doc.toJS({ maxAliasCount: 0 });
}

export async function readWorkflows(root) {
  const directory = join(root, '.github/workflows');
  return Promise.all(
    (await readdir(directory))
      .filter((name) => /\.ya?ml$/.test(name))
      .sort()
      .map(async (name) => ({
        name,
        workflow: parseWorkflow(await readFile(join(directory, name), 'utf8')),
      })),
  );
}

// This policy covers the unprivileged CI workflows. A future release workflow
// requires a separate, explicit review of its trust boundary and permissions.
export function validateWorkflows(workflows, pins, versions) {
  const errors = [];
  const check = (condition, where, message) => {
    if (!condition) errors.push(`${where}: ${message}`);
  };
  const readOnly = (permissions) =>
    permissions && Object.keys(permissions).length === 1 && permissions.contents === 'read';
  for (const { name, workflow: w } of workflows) {
    check(readOnly(w.permissions), name, 'CI permissions must be contents: read only');
    check(
      !/\bsecrets\b|\bgithub\.token\b/i.test(JSON.stringify(w)),
      name,
      'CI cannot reference secrets or explicit tokens',
    );
    const events = Object.keys(w.on ?? {});
    check(
      events.length &&
        events.every((e) => ['push', 'pull_request', 'workflow_dispatch', 'schedule'].includes(e)),
      name,
      'privileged or unknown event',
    );
    check(
      w.concurrency?.group === concurrencyGroup && w.concurrency?.['cancel-in-progress'] === true,
      name,
      'concurrency must cancel the obsolete run for the same workflow, event and PR/ref',
    );
    check(Object.keys(w.jobs ?? {}).length > 0, name, 'workflow must contain jobs');
    for (const [id, job] of Object.entries(w.jobs ?? {})) {
      const where = `${name}/${id}`;
      check(
        !job.uses && !job.environment,
        where,
        'CI cannot call a reusable workflow or deployment environment',
      );
      check(
        !job.permissions || readOnly(job.permissions),
        where,
        'job cannot elevate CI permissions',
      );
      check(
        Number.isInteger(job['timeout-minutes']) &&
          job['timeout-minutes'] > 0 &&
          job['timeout-minutes'] <= 90,
        where,
        'job timeout must be an integer from 1 to 90 minutes',
      );
      check(!job.strategy, where, 'matrix multiplication requires a new cost review');
      check(
        ['windows-2022', 'ubuntu-24.04'].includes(job['runs-on']),
        where,
        'use a supported hosted runner with an explicit OS version',
      );
      check(Array.isArray(job.steps) && job.steps.length > 0, where, 'CI must contain steps');
      for (const step of job.steps ?? []) {
        if (!step.uses) continue;
        const match = /^([\w-]+\/[\w.-]+)@([a-f0-9]{40})$/.exec(step.uses);
        const action = match?.[1];
        check(
          match && pins.actions[action]?.commit === match[2],
          where,
          `action must use its verified full commit: ${step.uses}`,
        );
        const input = step.with ?? {};
        if (action === 'actions/checkout')
          check(
            input['persist-credentials'] === false,
            where,
            'checkout must not persist credentials',
          );
        if (action === 'actions/setup-node') {
          check(
            input['node-version'] === versions.node,
            where,
            'Node must match the project version',
          );
          if (input.cache !== undefined)
            check(
              input.cache === '${{ ' + trustedCache + " && 'npm' || '' }}" &&
                input['cache-dependency-path'] === 'package-lock.json',
              where,
              'npm cache must be lockfile keyed and restricted to trusted pushes',
            );
        }
        if (action === 'dtolnay/rust-toolchain')
          check(input.toolchain === versions.rust, where, 'Rust must match rust-toolchain.toml');
        if (action === 'Swatinem/rust-cache') {
          check(step.if === trustedCache, where, 'Rust cache must be restricted to trusted pushes');
          check(
            input['prefix-key'] === 'pam-ci-v1' &&
              input.key === '${{ github.ref_name }}' &&
              !input['shared-key'],
            where,
            'Rust cache must isolate branch and job keys',
          );
          check(
            input['cache-targets'] === false &&
              input['cache-bin'] === false &&
              input['cache-on-failure'] === false,
            where,
            'Rust cache cannot reuse executable outputs or failed builds',
          );
        }
        if (action === 'actions/upload-artifact') {
          check(
            typeof input.name === 'string' &&
              [
                '${{ github.event_name }}',
                '${{ github.run_id }}',
                '${{ github.run_attempt }}',
              ].every((part) => input.name.includes(part)),
            where,
            'artifact name must identify event, run and attempt',
          );
          check(
            Number.isInteger(input['retention-days']) &&
              input['retention-days'] > 0 &&
              input['retention-days'] <= 7,
            where,
            'artifact retention must be at most seven days',
          );
          check(
            input['include-hidden-files'] === false &&
              input.overwrite === false &&
              input['if-no-files-found'] === 'error',
            where,
            'artifacts must exclude hidden files, refuse overwrite and report missing output',
          );
          const paths = (input.path ?? '').trim().split(/\r?\n/);
          const allowed = new Set([
            'artifacts/security/',
            'artifacts/PAM-windows-x64/',
            'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*setup.exe',
          ]);
          check(
            paths.length > 0 && paths.every((p) => allowed.has(p)),
            where,
            'artifact upload must use explicit build/evidence paths',
          );
        }
      }
    }
  }
  return errors;
}

export async function checkWorkflows(root) {
  const workflows = await readWorkflows(root);
  const pins = JSON.parse(await readFile(join(root, '.github/action-pins.json'), 'utf8'));
  const node = (await readFile(join(root, '.node-version'), 'utf8')).trim();
  const rust = /channel\s*=\s*"([^"]+)"/.exec(
    await readFile(join(root, 'rust-toolchain.toml'), 'utf8'),
  )?.[1];
  const errors = validateWorkflows(workflows, pins, { node, rust });
  if (errors.length) throw new Error(errors.join('\n'));
  return workflows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const workflows = await checkWorkflows(fileURLToPath(new URL('..', import.meta.url)));
    console.log(
      `CI policy verified: ${workflows.length} workflows, ${workflows.reduce((n, w) => n + Object.keys(w.workflow.jobs).length, 0)} bounded, unprivileged jobs`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
