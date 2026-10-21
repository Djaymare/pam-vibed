// Structural regression guard for the required quality barrier.
export function validateQualityWorkflow(w) {
  const errors = [];
  const check = (ok, message) => {
    if (!ok) errors.push(`quality: ${message}`);
  };
  const graph = {
    quick: [],
    'native-tests': ['quick'],
    linux: ['quick'],
    build: ['quick', 'native-tests', 'linux'],
  };
  check(
    JSON.stringify(Object.keys(w.jobs || {}).sort()) === JSON.stringify(Object.keys(graph).sort()),
    'unexpected quality job graph',
  );
  for (const [id, needs] of Object.entries(graph)) {
    const job = w.jobs?.[id];
    if (!job) {
      check(false, `missing ${id}`);
      continue;
    }
    check(
      JSON.stringify(job.needs || []) === JSON.stringify(needs),
      `${id} needs must include all required checks`,
    );
    check(
      job.if === undefined && !job['continue-on-error'],
      `${id} cannot bypass failure propagation`,
    );
    const phase = { quick: 'quick', 'native-tests': 'native', build: 'integration' }[id];
    const commands = phase ? [`npm run ci:${phase}`] : [];
    if (id === 'build') commands.push('npm run ci:package');
    let previous = -1;
    for (const command of commands) {
      const steps = job.steps || [];
      const index = steps.findIndex((s) => s.run === command);
      check(index > previous, `${id} must run ${command} in order`);
      check(
        steps.filter((s) => s.run === command).length === 1,
        `${id} requires exactly one ${command}`,
      );
      check(
        index >= 0 && steps[index].if === undefined && !steps[index]['continue-on-error'],
        `${command} cannot be conditional or allowed to fail`,
      );
      previous = index;
    }
    if (id === 'linux')
      check(
        (job.steps || []).some(
          (s) =>
            s.run?.includes('docker build --progress=plain') &&
            s.run.includes('docker run --rm pam-development') &&
            s.shell === 'bash' &&
            !s.if &&
            !s['continue-on-error'],
        ),
        'Linux validation must run, with pipefail',
      );
    let diagnostics = 0,
      packages = 0;
    for (const [index, s] of (job.steps || []).entries()) {
      check(!s['continue-on-error'], `${id} step cannot ignore a failure`);
      if (!s.uses?.startsWith('actions/upload-artifact@')) continue;
      const paths = (s.with?.path || '').trim().split(/\r?\n/);
      const isPackage = paths.some(
        (p) => p.includes('PAM-windows-x64') || p.includes('bundle/nsis'),
      );
      if (isPackage) {
        packages++;
        check(
          id === 'build' && index > previous && s.if === 'success()',
          'package upload must follow all checks and require success',
        );
        check(
          s.with.name.includes('${{ github.sha }}'),
          'package artifact must identify its commit',
        );
        check(paths.includes('artifacts/ci/'), 'package must include validation evidence');
      } else {
        diagnostics++;
        check(
          s.if === 'always()' && paths.includes('artifacts/ci/'),
          'diagnostics must survive failure',
        );
        check(
          paths.every((p) =>
            ['artifacts/ci/', 'artifacts/webview-tests/', 'artifacts/webview-cleanup/'].includes(p),
          ),
          'diagnostics cannot carry distributable packages',
        );
      }
    }
    check(diagnostics === 1, `${id} must keep exactly one diagnostics artifact`);
    check(packages === (id === 'build' ? 1 : 0), `${id} unexpected package upload`);
  }
  return errors;
}
