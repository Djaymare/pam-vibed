import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadCatalog, hash } from './runtime-integrity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function verifyBomInputs(projectRoot, bom) {
  for (const path of [
    'package-lock.json',
    'src-tauri/Cargo.lock',
    'security/runtime-components.json',
  ]) {
    const recorded = bom.metadata?.properties?.find(
      (p) => p.name === `pam:input-sha256:${path}`,
    )?.value;
    if (!recorded || recorded !== (await hash(join(projectRoot, path))))
      throw new Error(`SBOM périmé ou sans provenance : ${path}. Régénérer le SBOM.`);
  }
}
export async function fetchJson(url, options = {}, fetcher = fetch) {
  const r = await fetcher(url, {
    ...options,
    signal: AbortSignal.timeout(60_000),
    headers: { Accept: 'application/json', ...options.headers },
  });
  if (!r.ok) throw new Error(`${r.status} : ${url}`);
  return r.json();
}

export function auditQueries(bom) {
  const unique = new Map();
  for (const c of bom.components) {
    if (!c.purl) continue;
    const kind = c.purl.startsWith('pkg:cargo/')
      ? 'crates.io'
      : c.purl.startsWith('pkg:npm/')
        ? 'npm'
        : null;
    if (kind)
      unique.set(`${kind}:${c.name}@${c.version}`, {
        version: c.version,
        package: { name: c.name, ecosystem: kind },
      });
  }
  return [...unique.values()];
}
export async function osvAudit(bom, fetcher = fetch) {
  const queries = auditQueries(bom),
    findings = [];
  for (let offset = 0; offset < queries.length; offset += 100) {
    const batch = queries.slice(offset, offset + 100);
    const result = await fetchJson(
      'https://api.osv.dev/v1/querybatch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: batch }),
      },
      fetcher,
    );
    if (!Array.isArray(result.results) || result.results.length !== batch.length)
      throw new Error('Réponse OSV incomplète.');
    for (let i = 0; i < batch.length; i++)
      for (const v of result.results[i].vulns || []) {
        if (typeof v.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(v.id))
          throw new Error('Identifiant OSV invalide.');
        findings.push({
          package: batch[i].package,
          version: batch[i].version,
          id: v.id,
          modified: v.modified,
          source: `https://osv.dev/vulnerability/${v.id}`,
          scopes: [
            ...new Set(
              bom.components
                .filter((c) => c.name === batch[i].package.name && c.version === batch[i].version)
                .flatMap(
                  (c) =>
                    c.properties?.filter((p) => p.name === 'pam:scope').map((p) => p.value) || [],
                ),
            ),
          ],
        });
      }
  }
  return {
    source: 'https://api.osv.dev/v1/querybatch',
    queried: queries.length,
    ecosystems: ['npm', 'crates.io (RustSec and OSV sources)'],
    findings,
  };
}

function newer(a, b) {
  const current = a.replace(/^v/, '').split('.').map(Number),
    pinned = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (current[i] !== pinned[i]) return current[i] > pinned[i];
  }
  return false;
}
export async function monitorRuntime(catalog, fetcher = fetch) {
  const observations = [];
  const node = catalog.components.find((c) => c.id === 'node');
  const releases = await fetchJson(node.updates, {}, fetcher);
  const line = releases.filter((r) => r.version.split('.')[0] === `v${node.version.split('.')[0]}`);
  if (!line.length) throw new Error('Ligne Node absente de l’index officiel.');
  observations.push({
    component: 'node',
    pinned: node.version,
    latestInMajor: line[0].version,
    updateAvailable: newer(line[0].version, node.version),
    securityReleasesAfterPin: line
      .filter((r) => r.security && newer(r.version, node.version))
      .map((r) => ({ version: r.version, date: r.date })),
    source: node.updates,
    advisorySource: node.security,
    conclusion:
      'A newer/security release is a review signal; applicability needs the official release advisory.',
  });
  for (const c of catalog.components.filter((c) => c.ecosystem === 'npm')) {
    const source = `https://registry.npmjs.org/${encodeURIComponent(c.name)}/latest`;
    const latest = await fetchJson(source, {}, fetcher);
    if (typeof latest.version !== 'string') throw new Error(`Version npm absente : ${c.name}`);
    observations.push({
      component: c.id,
      pinned: c.version,
      latest: latest.version,
      updateAvailable: latest.version !== c.version,
      source,
    });
  }
  for (const repo of [...new Set(catalog.components.filter((c) => c.repo).map((c) => c.repo))]) {
    const source = `https://huggingface.co/api/models/Cactus-Compute/${repo}`;
    const current = await fetchJson(source, {}, fetcher);
    if (!/^[a-f0-9]{40}$/.test(current.sha)) throw new Error(`Révision HF absente : ${repo}`);
    const pinned = catalog.components.find((c) => c.repo === repo).revision;
    observations.push({
      component: `Cactus-Compute/${repo}`,
      pinned,
      latestRevision: current.sha,
      updateAvailable: current.sha !== pinned,
      source,
      conclusion:
        'Repository change signal only; binary/model changes and security applicability require review. No complete native advisory database is claimed.',
    });
  }
  return observations;
}

export async function runAudit(projectRoot, bom, { npmRun, fetcher = fetch } = {}) {
  if (!npmRun) {
    const cli =
      process.env.npm_execpath ||
      (process.platform === 'win32'
        ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
        : null);
    npmRun = () =>
      cli
        ? spawnSync(process.execPath, [cli, 'audit', '--json', '--ignore-scripts'], {
            cwd: projectRoot,
            encoding: 'utf8',
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
          })
        : spawnSync(
            process.platform === 'win32' ? 'npm.cmd' : 'npm',
            ['audit', '--json', '--ignore-scripts'],
            { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
          );
  }
  const errors = [],
    report = {
      observedAtUtc: new Date().toISOString(),
      mode: 'observation; --gate enforces no untriaged findings or upstream changes',
      scope: [
        'npm audit: root lock including dev dependencies',
        'OSV: every unique npm/crates.io identity in SBOM, including Koffi and Node-vendored npm',
        'Node official release index, Koffi npm registry, pinned HF model repositories',
      ],
      limitations: [
        'No absence-of-risk claim for native code, models, OS, WebView2 or opaque native transitive libraries.',
        'OSV matches are advisory evidence, not a proven exploit in PAM.',
        'Monitoring an upstream revision is not an automatic update or a vulnerability verdict.',
      ],
      errors,
    };
  try {
    const result = npmRun();
    if (result.error) throw result.error;
    const data = JSON.parse(result.stdout);
    if (![0, 1].includes(result.status) || data.error || !data.metadata?.vulnerabilities)
      throw new Error(`npm audit unavailable: ${result.stderr || result.stdout}`);
    report.npm = { exitCode: result.status, data };
  } catch (e) {
    errors.push({ check: 'npm-audit', error: e.message });
  }
  try {
    report.osv = await osvAudit(bom, fetcher);
  } catch (e) {
    errors.push({ check: 'osv-audit', error: e.message });
  }
  try {
    report.runtime = await monitorRuntime(await loadCatalog(projectRoot), fetcher);
  } catch (e) {
    errors.push({ check: 'runtime-monitor', error: e.message });
  }
  report.complete = errors.length === 0;
  report.needsReview = !!(
    report.osv?.findings.length ||
    report.npm?.data.metadata.vulnerabilities.total ||
    report.runtime?.some((r) => r.updateAvailable)
  );
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = resolve(
    process.argv.find((a) => a.endsWith('.json')) || join(root, 'artifacts/security/sbom.cdx.json'),
  );
  const output = join(root, 'artifacts/security/audit.json');
  try {
    const bytes = await readFile(input),
      bom = JSON.parse(bytes);
    await verifyBomInputs(root, bom);
    const report = await runAudit(root, bom);
    report.sbomSha256 = createHash('sha256').update(bytes).digest('hex');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify(
        {
          complete: report.complete,
          needsReview: report.needsReview,
          npm: report.npm?.data.metadata.vulnerabilities,
          osvFindings: report.osv?.findings.length,
          runtimeChanges: report.runtime?.filter((c) => c.updateAvailable),
          errors: report.errors,
          output,
        },
        null,
        2,
      ),
    );
    if (!report.complete || (process.argv.includes('--gate') && report.needsReview))
      process.exitCode = 1;
  } catch (e) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(
      output,
      JSON.stringify(
        {
          observedAtUtc: new Date().toISOString(),
          complete: false,
          errors: [{ check: 'input-or-audit', error: e.message }],
        },
        null,
        2,
      ) + '\n',
    );
    console.error(e);
    process.exitCode = 1;
  }
}
