import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function developmentBindings(platform, arch) {
  if (arch !== 'x64' || !['win32', 'linux'].includes(platform)) {
    throw new Error('Le développement documenté cible Windows x64 ou Linux x64 avec glibc.');
  }
  const suffix = platform === 'win32' ? 'win32-x64-msvc' : 'linux-x64-gnu';
  return [`@rolldown/binding-${suffix}`, `@tauri-apps/cli-${suffix}`];
}

export function checkDevelopment(root, {
  platform = process.platform, arch = process.arch, nodeVersion = process.versions.node,
  npmAgent = process.env.npm_config_user_agent,
  load = createRequire(pathToFileURL(join(root, 'package.json'))),
} = {}) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (nodeVersion !== manifest.engines.node) {
    throw new Error(`Node ${manifest.engines.node} requis ; version active : ${nodeVersion}.`);
  }
  if (npmAgent && npmAgent.split(' ')[0] !== `npm/${manifest.engines.npm}`) {
    throw new Error(`npm ${manifest.engines.npm} requis ; gestionnaire actif : ${npmAgent.split(' ')[0]}.`);
  }
  const bindings = developmentBindings(platform, arch);
  const launcher = join(root, 'node_modules', '.bin', platform === 'win32' ? 'vue-tsc.cmd' : 'vue-tsc');
  if (!existsSync(launcher)) {
    throw new Error(`Lanceur ${platform} de vue-tsc absent. Utilisez un checkout propre à cet OS puis npm ci. Ne partagez pas node_modules et ne supprimez pas les dépendances d'un autre environnement.`);
  }
  for (const binding of bindings) {
    try { load(binding); } catch (cause) {
      throw new Error(`Binding natif ${binding} indisponible. Utilisez un checkout propre à cet OS puis npm ci, avec les dépendances optionnelles. Ne réutilisez pas node_modules d'un autre OS.`, { cause });
    }
  }
  return { platform, arch, node: nodeVersion, npm: manifest.engines.npm, bindings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(checkDevelopment(resolve(dirname(fileURLToPath(import.meta.url)), '..')), null, 2));
  } catch (error) {
    console.error(error.message);
    if (error.cause) console.error(error.cause.message);
    process.exitCode = 1;
  }
}
