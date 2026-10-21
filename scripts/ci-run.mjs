// Bounded, shell-free CI commands. Reports survive the first failing command.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = 'x86_64-pc-windows-msvc';
const cargo = (...args) => ({ program: 'cargo', args, timeoutMs: 30 * 60_000 });
export function checksFor(phase, npmCli = process.env.npm_execpath) {
  if (!npmCli) throw Error('Run through npm run ci:<phase> so the pinned npm CLI is known.');
  const npm = (...args) => ({ program: process.execPath, args: [npmCli, ...args] });
  const script = (name) => npm('run', name);
  const node = (...args) => ({ program: process.execPath, args });
  const phases = {
    quick: [
      script('check:development'),
      script('check:workflows'),
      script('format:check'),
      script('lint'),
      npm('test'),
      script('test:components'),
      script('build'),
    ],
    native: [
      node('scripts/prepare-native-tests.mjs'),
      cargo('fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--check'),
      node('--test', 'tests/ci-archive.test.mjs'),
      cargo(
        'clippy',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        '--locked',
        '--target',
        target,
        '--all-targets',
        '--',
        '-D',
        'warnings',
      ),
      cargo('test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--target', target),
      {
        program: 'rustc',
        args: [
          '--edition',
          '2021',
          '--target',
          target,
          'tests/fixtures/process-fixture.rs',
          '-o',
          '.runtime-cache/ci-process-fixture.exe',
        ],
      },
      node('scripts/test-native-history.mjs', 'rustc', '.runtime-cache/ci-process-fixture.exe'),
      script('test:modals:build'),
      script('test:webview'),
      script('test:webview:cleanup'),
    ],
    integration: [
      script('prepare:runtime'),
      cargo(
        'test',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        '--locked',
        '--target',
        target,
        '--features',
        'engine-integration',
      ),
      script('test:integration:node'),
      script('test:integration'),
      script('test:confidence'),
      script('test:deezer:routing'),
      script('test:media:commands'),
    ],
    package: [
      script('package:windows'),
      script('package:portable'),
      script('verify:bundle'),
      node('scripts/ci-artifact.mjs'),
      node('scripts/ci-archive.mjs'),
    ],
  };
  if (!phases[phase]) throw Error(`Unknown CI phase: ${phase}`);
  return phases[phase].map((c) => ({ timeoutMs: 15 * 60_000, ...c }));
}

async function terminate(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise((done) => {
      const killer = spawn(
        join(process.env.SystemRoot, 'System32/taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, shell: false, stdio: 'ignore' },
      );
      killer.once('error', done);
      killer.once('close', done);
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
  }
}

export async function runChecks(
  checks,
  { directory, cwd = root, env = process.env, identity = {}, echo = true } = {},
) {
  await mkdir(directory, { recursive: true });
  const report = {
    schemaVersion: 1,
    ...identity,
    startedAt: new Date().toISOString(),
    outcome: 'running',
    checks: [],
  };
  const save = () =>
    writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await save();
  for (const [index, command] of checks.entries()) {
    const name = `${String(index + 1).padStart(2, '0')}.log`;
    const stream = createWriteStream(join(directory, name));
    const item = {
      program: command.program,
      args: command.args,
      log: name,
      timeoutMs: command.timeoutMs,
      startedAt: new Date().toISOString(),
      exitCode: null,
    };
    report.checks.push(item);
    const started = Date.now();
    if (echo)
      console.log(`CI ${index + 1}/${checks.length}: ${command.program} ${command.args.join(' ')}`);
    const child = spawn(command.program, command.args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let termination;
    const timer = setTimeout(() => {
      item.timedOut = true;
      termination = terminate(child).catch((e) => {
        item.terminationError = e.message;
      });
    }, command.timeoutMs);
    child.stdout.on('data', (b) => {
      stream.write(b);
      if (echo) process.stdout.write(b);
    });
    child.stderr.on('data', (b) => {
      stream.write(b);
      if (echo) process.stderr.write(b);
    });
    child.once('error', (e) => {
      item.error = e.message;
      stream.write(e.message + '\n');
    });
    const [code, signal] = await new Promise((done) =>
      child.once('close', (...result) => done(result)),
    );
    clearTimeout(timer);
    if (termination) await termination;
    stream.end();
    await once(stream, 'finish');
    item.exitCode = code;
    item.signal = signal;
    item.elapsedMs = Date.now() - started;
    item.passed = code === 0 && !item.timedOut && !item.error;
    await save();
    if (!item.passed) {
      report.outcome = 'failed';
      break;
    }
  }
  if (report.outcome === 'running') report.outcome = 'passed';
  report.finishedAt = new Date().toISOString();
  await save();
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const phase = process.argv[2];
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const workingTreeClean =
      execFileSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      }).trim() === '';
    const directory = join(root, 'artifacts/ci', phase);
    await mkdir(join(root, '.runtime-cache'), { recursive: true });
    const env = { ...process.env };
    if (phase === 'native')
      env.PAM_MODAL_TEST_HOST = join(
        resolve(root, env.CARGO_TARGET_DIR || 'src-tauri/target'),
        target,
        'debug/examples/modal-test-host.exe',
      );
    const report = await runChecks(checksFor(phase), {
      directory,
      env,
      identity: {
        phase,
        commit,
        workingTreeClean,
        runId: env.GITHUB_RUN_ID || null,
        runAttempt: env.GITHUB_RUN_ATTEMPT || null,
        node: process.version,
        platform: process.platform,
      },
    });
    process.exitCode = report.outcome === 'passed' ? 0 : 1;
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
