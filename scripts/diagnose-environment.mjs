// Informational only: no package loading, rustup proxies, network or repair.
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { developmentBindings } from './check-development.mjs';
import { signingConfiguration } from './windows-signing.mjs';

// Read registry declarations only; never instantiate WebView2 or change a policy.
export const windowsInventory = String.raw`
$ErrorActionPreference = 'Stop'
$result = @{}
try {
  $versions = @()
  foreach ($key in @('HKCU:\Software\Microsoft\EdgeUpdate\Clients', 'HKLM:\Software\Microsoft\EdgeUpdate\Clients', 'HKLM:\Software\WOW6432Node\Microsoft\EdgeUpdate\Clients')) {
    if (Test-Path -LiteralPath $key) {
      foreach ($child in Get-ChildItem -LiteralPath $key) {
        $p = Get-ItemProperty -LiteralPath $child.PSPath
        if ($p.name -like '*WebView2*' -and $p.pv -and $p.pv -ne '0.0.0.0') { $versions += $p.pv }
      }
    }
  }
  $result.webview = @($versions | Sort-Object -Unique)
} catch { $result.webview = $null }
try {
  $versions = @()
  foreach ($key in @('HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows Kits\Installed Roots')) {
    if (Test-Path -LiteralPath $key) {
      $sdk = Get-ItemProperty -LiteralPath $key
      if ($sdk.KitsRoot10 -and (Test-Path -LiteralPath (Join-Path $sdk.KitsRoot10 'Include'))) {
        foreach ($dir in Get-ChildItem -LiteralPath (Join-Path $sdk.KitsRoot10 'Include') -Directory) {
          if ((Test-Path -LiteralPath (Join-Path $dir.FullName 'um\Windows.h') -PathType Leaf) -and
              (Test-Path -LiteralPath (Join-Path $sdk.KitsRoot10 ('Lib\' + $dir.Name + '\um\x64\kernel32.lib')) -PathType Leaf)) { $versions += $dir.Name }
        }
      }
    }
  }
  $result.sdk = @($versions | Sort-Object -Unique)
} catch { $result.sdk = $null }
$result | ConvertTo-Json -Compress
`;

export function diagnoseEnvironment(
  root,
  {
    platform = process.platform,
    arch = process.arch,
    nodeVersion = process.versions.node,
    env = process.env,
    execPath = process.execPath,
    home = homedir(),
    release = false,
    read = readFileSync,
    stat = statSync,
    list = readdirSync,
    resolveBinding = createRequire(pathToFileURL(join(root, 'package.json'))).resolve,
    run = (program, args) =>
      spawnSync(program, args, {
        cwd: root,
        env,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 256 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    findProgram,
  } = {},
) {
  const checks = [];
  const add = (section, name, status, detail) => checks.push({ section, name, status, detail });
  const available = (section, name, detail) => add(section, name, 'disponible', detail);
  const unknown = (section, name, detail) => add(section, name, 'non vérifié', detail);
  const failure = (error) =>
    error?.code === 'ENOENT' || error?.code === 'MODULE_NOT_FOUND' ? 'manquant' : 'non vérifié';
  const file = (section, name, path) => {
    try {
      if (!stat(path).isFile()) {
        unknown(section, name, 'Le chemin ne désigne pas un fichier.');
        return false;
      }
      available(section, name, 'Fichier présent ; contenu et exécution non vérifiés.');
      return true;
    } catch (error) {
      add(
        section,
        name,
        failure(error),
        error?.code === 'ENOENT' ? 'Fichier absent.' : 'Fichier illisible.',
      );
      return false;
    }
  };
  const isFile = (path) => {
    try {
      return stat(path).isFile();
    } catch {
      return false;
    }
  };
  const pathEntries = (env.PATH || env.Path || '')
    .split(platform === 'win32' ? ';' : ':')
    .filter(Boolean);
  const find =
    findProgram ||
    ((name) =>
      pathEntries.map((p) => join(p, platform === 'win32' ? `${name}.exe` : name)).find(isFile));
  const invoke = (program, args) => {
    try {
      return run(program, args);
    } catch {
      return { status: null };
    }
  };
  // Never print raw subprocess output, errors, Git identities, URLs or paths.
  const version = (section, name, program, args, pattern, expected) => {
    if (!program) {
      add(
        section,
        name,
        'manquant',
        `Outil non trouvé dans les emplacements inspectés.${expected ? ` Version requise : ${expected}.` : ''}`,
      );
      return;
    }
    const result = invoke(program, args);
    const observed =
      result.status === 0 && !result.error && String(result.stdout).match(pattern)?.[1];
    if (!observed) {
      const cause =
        result.error?.code === 'ETIMEDOUT'
          ? 'Délai de lecture de version dépassé (5 s).'
          : result.error
            ? 'Commande de version inaccessible.'
            : result.status !== 0
              ? `Commande de version en échec${Number.isInteger(result.status) ? ` (code ${result.status})` : ''}.`
              : 'Sortie de version non reconnue.';
      unknown(section, name, cause);
      return;
    }
    add(
      section,
      name,
      !expected || observed === expected ? 'disponible' : 'non vérifié',
      `${observed}${expected ? ` ; requis : ${expected}${observed !== expected ? ' (écart)' : ''}` : ''}.`,
    );
  };
  const readJson = (path) => JSON.parse(read(path, 'utf8'));
  let manifest;
  try {
    manifest = readJson(join(root, 'package.json'));
  } catch {
    unknown('Développement', 'Versions requises', 'package.json absent, illisible ou invalide.');
  }
  const supported = arch === 'x64' && ['win32', 'linux'].includes(platform);
  add(
    'Développement',
    'Plateforme',
    supported ? 'disponible' : 'non vérifié',
    `${platform}/${arch} ; développement documenté Windows x64 ou Linux x64 glibc.`,
  );
  add(
    'Développement',
    'Node actif',
    manifest?.engines?.node === nodeVersion ? 'disponible' : 'non vérifié',
    `${nodeVersion} ; requis : ${manifest?.engines?.node || 'inconnu'}.`,
  );
  // Read npm's installed manifest rather than invoking npm.cmd/PowerShell or npm hooks.
  const npmCandidates = [
    env.npm_execpath,
    join(dirname(execPath), 'node_modules/npm/bin/npm-cli.js'),
    ...pathEntries.flatMap((p) => [
      join(p, 'node_modules/npm/bin/npm-cli.js'),
      join(p, '../lib/node_modules/npm/bin/npm-cli.js'),
      join(p, '../share/nodejs/npm/bin/npm-cli.js'),
    ]),
  ].filter((p) => p && isAbsolute(p));
  const npmCli = npmCandidates.find(isFile);
  if (npmCli) {
    try {
      const observed = readJson(join(dirname(npmCli), '../package.json')).version;
      if (!/^\d+\.\d+\.\d+$/.test(observed)) throw Error('version');
      add(
        'Développement',
        'npm installé',
        observed === manifest?.engines?.npm ? 'disponible' : 'non vérifié',
        `${observed} ; requis : ${manifest?.engines?.npm || 'inconnu'} ; manifeste du CLI, sans exécution du lanceur.`,
      );
    } catch {
      unknown('Développement', 'npm installé', 'Manifeste du CLI absent, illisible ou invalide.');
    }
  } else
    add(
      'Développement',
      'npm installé',
      'manquant',
      'CLI npm non trouvé auprès de Node, du PATH ou de npm_execpath.',
    );
  if (supported) {
    file(
      'Développement',
      'Lanceur vue-tsc',
      join(root, 'node_modules/.bin', platform === 'win32' ? 'vue-tsc.cmd' : 'vue-tsc'),
    );
    for (const binding of developmentBindings(platform, arch)) {
      try {
        file('Développement', binding, resolveBinding(binding));
      } catch (error) {
        add(
          'Développement',
          binding,
          failure(error),
          'Résolution du binding impossible ; aucun module chargé.',
        );
      }
    }
  }
  unknown(
    'Développement',
    'Chargement des bindings',
    'Non tenté ; check:development reste le contrôle bloquant existant.',
  );
  if (platform === 'linux')
    unknown(
      'Développement',
      'glibc',
      'ABI non testée ; Linux musl non couvert par le développement documenté.',
    );

  const git = find('git');
  version('Git', 'Git', git, ['--version'], /^git version (\d+\.\d+\.\d+(?:\.windows\.\d+)?)/);
  if (git) {
    const repo = invoke(git, ['rev-parse', '--is-inside-work-tree']);
    const inRepo = repo.status === 0 && !repo.error && repo.stdout?.trim() === 'true';
    add(
      'Git',
      'Checkout',
      inRepo ? 'disponible' : 'non vérifié',
      inRepo ? 'Dépôt reconnu.' : 'Dépôt non reconnu ou inaccessible.',
    );
    if (inRepo) {
      const remote = invoke(git, ['remote']);
      add(
        'Git',
        'Remote configuré',
        remote.status === 0 && !remote.error
          ? remote.stdout?.trim()
            ? 'disponible'
            : 'manquant'
          : 'non vérifié',
        'Présence locale uniquement ; URL, accès réseau et droits non vérifiés.',
      );
      for (const key of ['user.name', 'user.email']) {
        const result = invoke(git, ['config', '--get', key]);
        add(
          'Git',
          key,
          result.status === 0 && !result.error && result.stdout?.trim()
            ? 'disponible'
            : result.status === 1 && !result.error
              ? 'manquant'
              : 'non vérifié',
          'Présence de configuration uniquement ; valeur masquée, identité effective du commit non vérifiée.',
        );
      }
    }
  }

  add(
    'Rust',
    'rustup',
    find('rustup') ? 'disponible' : 'manquant',
    'Présence du lanceur dans le PATH uniquement ; rustup non exécuté, même pour sa version.',
  );
  let channel;
  try {
    channel = read(join(root, 'rust-toolchain.toml'), 'utf8').match(
      /^channel\s*=\s*"(\d+\.\d+\.\d+)"/m,
    )?.[1];
  } catch {}
  const host = platform === 'win32' ? 'x86_64-pc-windows-msvc' : 'x86_64-unknown-linux-gnu';
  const toolchain = join(
    env.RUSTUP_HOME || join(home, '.rustup'),
    'toolchains',
    `${channel}-${host}`,
  );
  if (supported && channel) {
    // Direct installed binaries only: a rustup proxy can download an absent toolchain.
    for (const [name, expected] of [
      ['rustc', channel],
      ['cargo', channel],
      ['rustfmt'],
      ['clippy-driver'],
    ]) {
      const binary = join(toolchain, 'bin', name + (platform === 'win32' ? '.exe' : ''));
      version(
        'Rust',
        name,
        isFile(binary) ? binary : undefined,
        ['--version'],
        /^(?:rustc|cargo|rustfmt|clippy) (\d+\.\d+\.\d+)/,
        expected,
      );
    }
    const target = join(toolchain, 'lib/rustlib/x86_64-pc-windows-msvc/lib');
    try {
      const std = list(target).some((name) => /^libstd-.*\.rlib$/.test(name));
      add(
        'Rust',
        'Cible Windows MSVC',
        std ? 'disponible' : 'manquant',
        std
          ? 'Bibliothèque standard installée ; aucune compilation.'
          : 'Répertoire présent, bibliothèque standard introuvable.',
      );
    } catch (error) {
      add(
        'Rust',
        'Cible Windows MSVC',
        failure(error),
        'Bibliothèque standard absente ou illisible.',
      );
    }
  } else
    unknown(
      'Rust',
      'Toolchain épinglée',
      'Plateforme non prise en charge ou version requise illisible.',
    );
  unknown(
    'Rust',
    'Sélection active',
    'Seule la toolchain épinglée installée est inspectée ; overrides et proxies non exécutés.',
  );

  let powershell;
  for (const name of ['powershell', 'pwsh']) {
    const legacy =
      platform === 'win32' && name === 'powershell' && env.SystemRoot
        ? join(env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
        : undefined;
    const program = find(name) || (legacy && isFile(legacy) ? legacy : undefined);
    version(
      'PowerShell',
      name,
      program,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$PSVersionTable.PSVersion.ToString()',
      ],
      /^(\d+\.\d+\.\d+(?:\.\d+)?)/,
    );
    if (program && !powershell) powershell = program;
  }
  unknown(
    'PowerShell',
    'Exécution des scripts locaux',
    'Aucune politique lue ou modifiée ; un hôte disponible ne prouve pas que les fichiers .ps1 seront autorisés.',
  );

  if (platform === 'win32' && arch === 'x64') {
    const vswhere =
      env['ProgramFiles(x86)'] &&
      join(env['ProgramFiles(x86)'], 'Microsoft Visual Studio/Installer/vswhere.exe');
    version(
      'Windows natif',
      'MSVC x64 déclaré',
      vswhere && isFile(vswhere) ? vswhere : undefined,
      [
        '-latest',
        '-products',
        '*',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property',
        'installationVersion',
      ],
      /^(\d+\.\d+\.\d+(?:\.\d+)?)/,
    );
    const result =
      powershell &&
      invoke(powershell, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        windowsInventory,
      ]);
    let inventory;
    try {
      if (result?.status === 0 && !result.error)
        inventory = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
    } catch {}
    for (const [key, name] of [
      ['sdk', 'Windows SDK x64'],
      ['webview', 'WebView2 enregistré'],
    ]) {
      const versions = inventory?.[key];
      if (
        !Array.isArray(versions) ||
        !versions.every((v) => typeof v === 'string' && /^\d+(?:\.\d+){2,3}$/.test(v))
      ) {
        unknown(
          'Windows natif',
          name,
          'Inventaire indisponible (hôte, accès registre ou lecture impossible).',
        );
      } else
        add(
          'Windows natif',
          name,
          versions.length ? 'disponible' : 'manquant',
          versions.length
            ? `${versions.join(', ')} ; déclaration/fichiers uniquement, fonctionnement non testé.`
            : key === 'webview'
              ? 'Aucun runtime enregistré trouvé ; un runtime WebView2 privé reste non vérifié.'
              : 'Aucun SDK avec en-tête Windows et bibliothèque x64 trouvé.',
        );
    }
    const targetRoot = resolve(root, env.CARGO_TARGET_DIR || 'src-tauri/target');
    const examples = join(targetRoot, 'x86_64-pc-windows-msvc/debug/examples');
    file(
      'Windows natif',
      'Hôte modal compilé',
      env.PAM_MODAL_TEST_HOST || join(examples, 'modal-test-host.exe'),
    );
    if (!env.PAM_MODAL_TEST_HOST)
      unknown(
        'Windows natif',
        'PAM_MODAL_TEST_HOST',
        'Non défini ; les runners modals exigent ce paramètre explicite (ci:native le fournit).',
      );
    file(
      'Windows natif',
      'Hôte permissions compilé',
      env.PAM_PERMISSION_TEST_HOST || join(examples, 'permission-test-host.exe'),
    );
    file(
      'Windows natif',
      'Node de test préparé',
      join(root, 'src-tauri/binaries/pam-node-x86_64-pc-windows-msvc.exe'),
    );
  } else
    unknown(
      'Windows natif',
      'Tests Rust/WebView2',
      'Nécessitent Windows x64 ; aucune validation native sur cet hôte.',
    );
  unknown(
    'Windows natif',
    'Validation native',
    'Aucun test, hôte graphique ou produit lancé ; présence des fichiers sans preuve de fraîcheur, de hash ou de rendu.',
  );
  file('Moteurs', 'Manifeste runtime préparé', join(root, 'src-tauri/runtime/manifest.json'));
  unknown(
    'Moteurs',
    'Intégrité et disponibilité des moteurs',
    'Modèles, DLL et contenu du manifeste non validés ; aucune inférence ni préparation.',
  );

  if (release) {
    if (platform === 'win32') {
      if (env.PAM_SIGNTOOL_PATH && isAbsolute(env.PAM_SIGNTOOL_PATH))
        file('Signature / VM (optionnel)', 'SignTool configuré', env.PAM_SIGNTOOL_PATH);
      else
        add(
          'Signature / VM (optionnel)',
          'SignTool configuré',
          'manquant',
          'PAM_SIGNTOOL_PATH absolu absent ou invalide.',
        );
      if (env.PAM_POWERSHELL_PATH) {
        if (isAbsolute(env.PAM_POWERSHELL_PATH))
          file('Signature / VM (optionnel)', 'Hôte signature configuré', env.PAM_POWERSHELL_PATH);
        else
          unknown(
            'Signature / VM (optionnel)',
            'Hôte signature configuré',
            'PAM_POWERSHELL_PATH doit être absolu.',
          );
      }
      try {
        signingConfiguration(env);
        available(
          'Signature / VM (optionnel)',
          'Configuration de signature',
          'Format des paramètres valide ; valeurs masquées, certificat et serveur non vérifiés.',
        );
      } catch {
        unknown(
          'Signature / VM (optionnel)',
          'Configuration de signature',
          'Paramètres absents ou invalides ; valeurs masquées.',
        );
      }
    } else
      unknown(
        'Signature / VM (optionnel)',
        'Signature Windows',
        'Vérification native Windows requise.',
      );
    unknown(
      'Signature / VM (optionnel)',
      'Confiance et VM propre',
      'Clé, certificat, chaîne, révocation, horodatage, snapshots et scénarios N/N+1 non vérifiés automatiquement ; voir docs/windows-release.md.',
    );
  }
  return { schemaVersion: 1, informational: true, checks };
}

export function formatEnvironmentReport(report) {
  return [
    'Diagnostic PAM informatif — lecture seule',
    ...report.checks.map((c) => `[${c.status}] ${c.section} / ${c.name} : ${c.detail}`),
    'Ce rapport ne vaut ni validation native ni preuve de livraison.',
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--release') || args.length > 1) {
    console.log('Usage : node scripts/diagnose-environment.mjs [--release]');
    process.exitCode = 1;
  } else {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    console.log(
      formatEnvironmentReport(diagnoseEnvironment(root, { release: args.includes('--release') })),
    );
  }
}
