import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  diagnoseEnvironment,
  formatEnvironmentReport,
  windowsInventory,
} from '../scripts/diagnose-environment.mjs';
import { developmentBindings } from '../scripts/check-development.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const channel = '1.99.0';
const secret = 'NEVER_PRINT_IDENTITY_OR_TOKEN';
const ok = (stdout) => ({ status: 0, stdout });
const absent = () => ({ status: null, error: { code: 'ENOENT', message: secret }, stderr: secret });

function fixture(t, platform = 'win32', complete = true) {
  const root = mkdtempSync(join(tmpdir(), 'pam-environment-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, content = 'fixture') => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return path;
  };
  write(
    join(root, 'package.json'),
    JSON.stringify({ engines: { node: '24.21.0', npm: '11.19.0' } }),
  );
  write(join(root, 'rust-toolchain.toml'), `[toolchain]\nchannel = "${channel}"\n`);
  const env = {
    RUSTUP_HOME: join(root, 'rustup'),
    'ProgramFiles(x86)': join(root, 'programs'),
    CARGO_TARGET_DIR: join(root, 'target'),
    PAM_SIGNING_THUMBPRINT: 'a'.repeat(40),
    PAM_SIGNING_TIMESTAMP_URL: `https://timestamp.example/${secret}`,
    GIT_AUTHOR_NAME: secret,
  };
  const host = platform === 'win32' ? 'x86_64-pc-windows-msvc' : 'x86_64-unknown-linux-gnu';
  const ext = platform === 'win32' ? '.exe' : '';
  const toolchain = join(env.RUSTUP_HOME, 'toolchains', `${channel}-${host}`);
  const calls = [];
  if (complete) {
    env.npm_execpath = write(join(root, 'npm/bin/npm-cli.js'), `throw Error('${secret}')`);
    write(join(root, 'npm/package.json'), JSON.stringify({ version: '11.19.0' }));
    write(join(root, 'node_modules/.bin', platform === 'win32' ? 'vue-tsc.cmd' : 'vue-tsc'));
    for (const binding of developmentBindings(platform, 'x64')) {
      const dir = join(root, 'node_modules', binding);
      write(join(dir, 'package.json'), JSON.stringify({ main: 'index.cjs' }));
      write(join(dir, 'index.cjs'), `throw Error('${secret}: module must never load')`);
    }
    for (const name of ['rustc', 'cargo', 'rustfmt', 'clippy-driver'])
      write(join(toolchain, 'bin', name + ext));
    write(join(toolchain, 'lib/rustlib/x86_64-pc-windows-msvc/lib/libstd-fixture.rlib'));
    write(join(env['ProgramFiles(x86)'], 'Microsoft Visual Studio/Installer/vswhere.exe'));
    for (const name of ['modal', 'permission'])
      write(
        join(env.CARGO_TARGET_DIR, `x86_64-pc-windows-msvc/debug/examples/${name}-test-host.exe`),
      );
    env.PAM_MODAL_TEST_HOST = join(
      env.CARGO_TARGET_DIR,
      'x86_64-pc-windows-msvc/debug/examples/modal-test-host.exe',
    );
    write(join(root, 'src-tauri/binaries/pam-node-x86_64-pc-windows-msvc.exe'));
    write(join(root, 'src-tauri/runtime/manifest.json'));
    env.PAM_SIGNTOOL_PATH = write(join(root, 'signtool.exe'));
  }
  const programs = Object.fromEntries(
    ['git', 'rustup', 'powershell', 'pwsh'].map((name) => [name, join(root, name + ext)]),
  );
  const run = (program, args) => {
    calls.push({ program, args });
    if (program === programs.git) {
      if (args[0] === '--version') return ok('git version 2.50.1.windows.1');
      if (args[0] === 'rev-parse') return ok('true');
      if (args[0] === 'remote') return ok(secret);
      if (args[0] === 'config') return ok(secret);
    }
    if (program === programs.rustup) assert.fail('rustup must never execute, even for --version');
    if (program === programs.powershell || program === programs.pwsh) {
      return ok(
        args.at(-1) === windowsInventory
          ? JSON.stringify({ sdk: ['10.0.26100.0'], webview: ['130.0.2849.0'] })
          : '7.5.0',
      );
    }
    if (program.endsWith('vswhere.exe')) return ok('17.14.0.0');
    if (program === join(toolchain, 'bin', `rustc${ext}`)) return ok(`rustc ${channel} (fixture)`);
    if (program === join(toolchain, 'bin', `cargo${ext}`)) return ok(`cargo ${channel} (fixture)`);
    if (program === join(toolchain, 'bin', `rustfmt${ext}`))
      return ok('rustfmt 1.8.0-stable (fixture)');
    if (program === join(toolchain, 'bin', `clippy-driver${ext}`))
      return ok('clippy 0.1.99 (fixture)');
    assert.fail(`Unexpected executable: ${program}`);
  };
  return {
    root,
    env,
    calls,
    programs,
    toolchain,
    write,
    options: {
      platform,
      arch: 'x64',
      nodeVersion: '24.21.0',
      env,
      home: root,
      execPath: join(root, 'node'),
      findProgram: (name) => (complete ? programs[name] : undefined),
      run,
    },
  };
}

const byName = (report, name) => report.checks.find((c) => c.name === name);
function snapshot(root) {
  return readdirSync(root, { recursive: true })
    .filter((p) => statSync(join(root, p)).isFile())
    .sort()
    .map((p) => [p, readFileSync(join(root, p)).toString('hex')]);
}

for (const platform of ['win32', 'linux']) {
  test(`environnement ${platform} complet : présence sans chargement ni mutation`, (t) => {
    const f = fixture(t, platform);
    const before = snapshot(f.root);
    const report = diagnoseEnvironment(f.root, f.options);
    assert.equal(report.informational, true);
    for (const name of [
      'Node actif',
      'npm installé',
      'Lanceur vue-tsc',
      'Git',
      'Remote configuré',
      'user.name',
      'user.email',
      'rustc',
      'cargo',
      'rustfmt',
      'clippy-driver',
      'Cible Windows MSVC',
      ...developmentBindings(platform, 'x64'),
    ]) {
      assert.equal(byName(report, name).status, 'disponible', name);
    }
    assert.equal(byName(report, 'Chargement des bindings').status, 'non vérifié');
    assert.equal(byName(report, 'Validation native').status, 'non vérifié');
    assert.equal(
      report.checks.some((c) => c.section.startsWith('Signature')),
      false,
    );
    if (platform === 'win32')
      for (const name of [
        'MSVC x64 déclaré',
        'Windows SDK x64',
        'WebView2 enregistré',
        'Hôte modal compilé',
        'Hôte permissions compilé',
      ]) {
        assert.equal(byName(report, name).status, 'disponible', name);
      }
    else assert.equal(byName(report, 'Tests Rust/WebView2').status, 'non vérifié');
    assert.doesNotMatch(formatEnvironmentReport(report), new RegExp(secret));
    assert.deepEqual(snapshot(f.root), before);
    for (const call of f.calls) {
      if (call.program === f.programs.git)
        assert.ok(['--version', 'rev-parse', 'remote', 'config'].includes(call.args[0]));
      else if ([f.programs.powershell, f.programs.pwsh].includes(call.program)) {
        assert.deepEqual(call.args.slice(0, 4), [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
        ]);
        assert.ok(
          ['$PSVersionTable.PSVersion.ToString()', windowsInventory].includes(call.args.at(-1)),
        );
      } else if (call.program.endsWith('vswhere.exe'))
        assert.equal(call.args.at(-1), 'installationVersion');
      else {
        assert.deepEqual(call.args, ['--version']);
        assert.ok(call.program.startsWith(f.toolchain));
      }
    }
  });
}

test('environnement incomplet : toutes les absences sont rapportées sans arrêt ni proxy Rust', (t) => {
  const f = fixture(t, 'win32', false);
  const before = snapshot(f.root);
  const report = diagnoseEnvironment(f.root, f.options);
  for (const name of [
    'npm installé',
    'Lanceur vue-tsc',
    'Git',
    'rustup',
    'rustc',
    'cargo',
    'powershell',
    'pwsh',
    'Hôte modal compilé',
    'Manifeste runtime préparé',
  ]) {
    assert.equal(byName(report, name).status, 'manquant', name);
  }
  assert.equal(byName(report, 'WebView2 enregistré').status, 'non vérifié');
  assert.equal(byName(report, 'PAM_MODAL_TEST_HOST').status, 'non vérifié');
  assert.equal(f.calls.length, 0);
  assert.deepEqual(snapshot(f.root), before);
});

for (const [platform, arch] of [
  ['darwin', 'arm64'],
  ['win32', 'arm64'],
  ['linux', 'arm64'],
]) {
  test(`plateforme non prise en charge ${platform}/${arch} : aucune déduction native`, (t) => {
    const f = fixture(t, platform, false);
    const report = diagnoseEnvironment(f.root, { ...f.options, arch });
    assert.equal(byName(report, 'Plateforme').status, 'non vérifié');
    assert.equal(byName(report, 'Toolchain épinglée').status, 'non vérifié');
    assert.equal(byName(report, 'Tests Rust/WebView2').status, 'non vérifié');
    assert.equal(f.calls.length, 0);
  });
}

test('versions divergentes et erreurs de lecture ne deviennent pas des réussites', (t) => {
  const f = fixture(t);
  f.write(join(f.root, 'npm/package.json'), '{"version":"10.0.0"}');
  const report = diagnoseEnvironment(f.root, {
    ...f.options,
    nodeVersion: '22.0.0',
    resolveBinding: () => {
      throw Object.assign(Error(secret), { code: 'EACCES' });
    },
    run: () => ({ status: 0, stdout: secret }),
  });
  for (const name of [
    'Node actif',
    'npm installé',
    'Git',
    'rustc',
    'Windows SDK x64',
    ...developmentBindings('win32', 'x64'),
  ]) {
    assert.equal(byName(report, name).status, 'non vérifié', name);
  }
  assert.doesNotMatch(formatEnvironmentReport(report), new RegExp(secret));
});

test('Git sans remote/identité : configuration absente distinguée des erreurs et secrets masqués', (t) => {
  const f = fixture(t);
  const report = diagnoseEnvironment(f.root, {
    ...f.options,
    run: (program, args) => {
      if (program === f.programs.git && args[0] === 'remote') return ok('');
      if (program === f.programs.git && args.at(-1) === 'user.name')
        return { status: 1, stdout: '' };
      if (program === f.programs.git && args.at(-1) === 'user.email')
        return { status: 128, stderr: secret };
      return f.options.run(program, args);
    },
  });
  assert.equal(byName(report, 'Remote configuré').status, 'manquant');
  assert.equal(byName(report, 'user.name').status, 'manquant');
  assert.equal(byName(report, 'user.email').status, 'non vérifié');
  assert.doesNotMatch(formatEnvironmentReport(report), new RegExp(secret));
});

test('versions en échec, timeout, inventaire refusé ou vide : aucun faux positif', (t) => {
  const f = fixture(t);
  for (const result of [
    absent(),
    { status: 1, stdout: 'rustc 1.99.0', stderr: secret },
    { status: null, error: { code: 'ETIMEDOUT' }, stdout: 'rustc 1.99.0' },
  ]) {
    const report = diagnoseEnvironment(f.root, { ...f.options, run: () => result });
    for (const name of ['Git', 'rustc', 'powershell', 'Windows SDK x64', 'WebView2 enregistré'])
      assert.equal(byName(report, name).status, 'non vérifié');
    assert.doesNotMatch(formatEnvironmentReport(report), new RegExp(secret));
  }
  const report = diagnoseEnvironment(f.root, {
    ...f.options,
    run: () => ok('{"sdk":[],"webview":[]}'),
  });
  assert.equal(byName(report, 'Windows SDK x64').status, 'manquant');
  assert.equal(byName(report, 'WebView2 enregistré').status, 'manquant');
});

test('signature/VM strictement optionnelles : aucun outil de signature ni certificat exécuté ou lu', (t) => {
  const f = fixture(t);
  const report = diagnoseEnvironment(f.root, { ...f.options, release: true });
  assert.equal(byName(report, 'SignTool configuré').status, 'disponible');
  assert.equal(byName(report, 'Configuration de signature').status, 'disponible');
  assert.equal(byName(report, 'Confiance et VM propre').status, 'non vérifié');
  assert.ok(f.calls.every((call) => call.program !== f.env.PAM_SIGNTOOL_PATH));
  assert.doesNotMatch(formatEnvironmentReport(report), new RegExp(secret));
  delete f.env.PAM_SIGNTOOL_PATH;
  delete f.env.PAM_SIGNING_THUMBPRINT;
  const missing = diagnoseEnvironment(f.root, { ...f.options, release: true });
  assert.equal(byName(missing, 'SignTool configuré').status, 'manquant');
  assert.equal(byName(missing, 'Configuration de signature').status, 'non vérifié');
  f.env.PAM_POWERSHELL_PATH = 'relative-host.exe';
  const relative = diagnoseEnvironment(f.root, { ...f.options, release: true });
  assert.equal(byName(relative, 'Hôte signature configuré').status, 'non vérifié');
});

test('manifeste absent : le diagnostic poursuit les observations indépendantes', (t) => {
  const f = fixture(t);
  rmSync(join(f.root, 'package.json'));
  const report = diagnoseEnvironment(f.root, f.options);
  assert.equal(byName(report, 'Versions requises').status, 'non vérifié');
  assert.equal(byName(report, 'Node actif').status, 'non vérifié');
  assert.equal(byName(report, 'Git').status, 'disponible');
});

test('répertoire de cible vide et fichier illisible : causes explicites, sans réussite', (t) => {
  const f = fixture(t);
  rmSync(join(f.toolchain, 'lib/rustlib/x86_64-pc-windows-msvc/lib/libstd-fixture.rlib'));
  const report = diagnoseEnvironment(f.root, {
    ...f.options,
    stat: (path) => {
      if (path === join(f.root, 'node_modules/.bin/vue-tsc.cmd'))
        throw Object.assign(Error(secret), { code: 'EACCES' });
      return statSync(path);
    },
  });
  assert.equal(byName(report, 'Cible Windows MSVC').status, 'manquant');
  assert.match(byName(report, 'Cible Windows MSVC').detail, /introuvable/);
  assert.equal(byName(report, 'Lanceur vue-tsc').status, 'non vérifié');
  assert.doesNotMatch(formatEnvironmentReport(report), new RegExp(secret));
});

test('CLI : arguments inconnus refusés sans lancer de sonde', () => {
  const result = spawnSync(
    process.execPath,
    [join(project, 'scripts/diagnose-environment.mjs'), '--repair'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^Usage/);
  assert.equal(result.stderr, '');
});

test('seule une entrée npm est ajoutée ; aucun démarrage ni runner CI ne dépend du diagnostic', () => {
  const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts['diagnose:environment'], 'node scripts/diagnose-environment.mjs');
  for (const [name, command] of Object.entries(manifest.scripts)) {
    if (name !== 'diagnose:environment') assert.doesNotMatch(command, /diagnose[\-:]/);
  }
  assert.doesNotMatch(readFileSync(join(project, 'scripts/ci-run.mjs'), 'utf8'), /diagnose[\-:]/);
  assert.doesNotMatch(
    readFileSync(join(project, 'src-tauri/tauri.conf.json'), 'utf8'),
    /diagnose[\-:]/,
  );
});
