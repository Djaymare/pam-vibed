const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEEZER_APP_ID, DEEZER_SOURCE_IDS } = require('./deezer.cjs');
const { validateStore, normalizePhrase } = require('./command-aliases.cjs');

const { LANGUAGES } = require('./languages.cjs');
const CURRENT_VERSION = 2;
const DEFAULT_CONFIG = { version: CURRENT_VERSION, applications: [], commandAliases: [], language: 'fr', autoExecute: false, confidenceThreshold: 0.7 };
const MAX_CONFIG_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ensure(condition, message) { if (!condition) throw new Error(message); }
function object(value, label) { ensure(value && typeof value === 'object' && !Array.isArray(value), `${label} invalide.`); }
function keys(value, allowed, label) { object(value, label); ensure(Object.keys(value).every(key => allowed.includes(key)), `${label} : champ inconnu.`); }
function cleanText(value, label, max = 200) {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0'), `${label} invalide.`);
  return value.trim();
}

function validateApplicationStructure(value, existingId) {
  object(value, 'Application');
  const name = cleanText(value.name, 'Nom', 60);
  const description = cleanText(value.description, 'Description', 240);
  const executable = cleanText(value.executable, 'Exécutable', 1024);
  ensure(path.win32.isAbsolute(executable) && executable.toLowerCase().endsWith('.exe'), 'Choisissez le chemin absolu d’un fichier .exe.');
  ensure(Array.isArray(value.arguments) && value.arguments.length <= 20 && value.arguments.every(argument =>
    typeof argument === 'string' && argument.length <= 2048 && !argument.includes('\0')), 'Arguments invalides (tableau de chaînes, 20 maximum).');
  ensure(Array.isArray(value.aliases), 'Alias de l’application invalides.');
  const aliases = value.aliases.map(alias => cleanText(alias, 'Alias', 40));
  ensure(aliases.length <= 6, 'Six alias maximum par application.');
  ensure(new Set(aliases.map(normalizePhrase)).size === aliases.length, 'Alias de l’application en doublon.');
  ensure(typeof value.enabled === 'boolean', 'État de l’application invalide.');
  let windowsApp;
  if (value.windowsApp !== undefined) {
    const target = value.windowsApp;
    keys(target, ['appId', 'kind', 'icon', 'launchArgument'], 'Application Windows');
    const appId = cleanText(target.appId, 'Application Windows', 1024);
    ensure(!/[\x00-\x1f]/.test(appId) && !appId.includes('{input}') && ['desktop', 'store'].includes(target.kind), 'Application Windows invalide.');
    const launchArgument = target.launchArgument ?? `shell:AppsFolder\\${appId}`;
    ensure(typeof launchArgument === 'string' && !/[\x00-\x1f]/.test(launchArgument) && !launchArgument.includes('{input}') &&
      (launchArgument === `shell:AppsFolder\\${appId}` || (target.kind === 'desktop' && appId === `shortcut:${launchArgument}` &&
        path.win32.isAbsolute(launchArgument) && launchArgument.toLowerCase().endsWith('.lnk'))), 'Raccourci Windows invalide.');
    ensure(path.win32.basename(executable).toLowerCase() === 'explorer.exe' && value.arguments.length === 1 &&
      value.arguments[0] === launchArgument, 'Le lancement doit correspondre à l’application Windows choisie.');
    const icon = target.icon ?? null;
    if (icon !== null) {
      ensure(typeof icon === 'string' && icon.length <= 32768 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(icon), 'Icône Windows invalide.');
      const bytes = Buffer.from(icon.slice('data:image/png;base64,'.length), 'base64');
      ensure(bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 64 &&
        bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 64, 'Icône Windows invalide.');
    }
    windowsApp = { appId, kind: target.kind, icon, ...(target.launchArgument ? { launchArgument } : {}) };
  }
  let media;
  if (value.media !== undefined) {
    ensure(value.media && typeof value.media === 'object' && !Array.isArray(value.media) &&
      Object.keys(value.media).every(key => ['sourceAppId','deezer'].includes(key)), 'Configuration multimédia invalide.');
    const sourceAppId = cleanText(value.media.sourceAppId, 'Identifiant de session Windows', 1024);
    ensure(!/[\x00-\x1f]/.test(sourceAppId) && typeof value.media.deezer === 'boolean', 'Lecteur multimédia invalide.');
    if (value.media.deezer) ensure(windowsApp?.appId === DEEZER_APP_ID && DEEZER_SOURCE_IDS.includes(sourceAppId), 'Le plugin Deezer doit cibler la session de Deezer Music.');
    media = { sourceAppId, deezer:value.media.deezer };
  }
  return { id: existingId || randomUUID(), name, description, executable,
    arguments: value.arguments, aliases, enabled: value.enabled, ...(windowsApp ? { windowsApp } : {}), ...(media ? {media} : {}) };
}

// Structural validation has no filesystem dependency. Availability is checked
// separately when registering/changing a target and immediately before launch.
function validateConfig(value) {
  keys(value, ['version', 'applications', 'commandAliases', 'language', 'autoExecute', 'confidenceThreshold'], 'Profil');
  ensure(value.version === 1 || value.version === CURRENT_VERSION, 'Version du profil incompatible. Utilisez une version de PAM compatible ou restaurez une sauvegarde.');
  ensure(LANGUAGES.has(value.language) && typeof value.autoExecute === 'boolean' &&
    Number.isFinite(value.confidenceThreshold) && value.confidenceThreshold >= 0.1 && value.confidenceThreshold <= 1, 'Préférences invalides.');
  ensure(Array.isArray(value.applications) && value.applications.length <= 32, 'Applications invalides (32 maximum).');
  const config = structuredClone(value);
  if (config.version === 1 && config.commandAliases === undefined) config.commandAliases = [];
  const ids = new Set(), names = new Set(), windowsIds = new Set();
  config.applications = value.applications.map((app, index) => {
    try {
      keys(app, ['id', 'name', 'description', 'executable', 'arguments', 'aliases', 'enabled', 'windowsApp', 'media'], 'Application');
      ensure(typeof app.id === 'string' && UUID.test(app.id), 'Identifiant d’application invalide (UUID requis).');
      ensure(Array.isArray(app.aliases), 'Alias de l’application invalides.');
      const result = validateApplicationStructure(app, app.id);
      const id = result.id.toLowerCase(), name = normalizePhrase(result.name);
      ensure(!ids.has(id) && !names.has(name), 'Applications en doublon (identifiant ou nom).');
      ids.add(id); names.add(name);
      if (result.windowsApp) {
        const windowsId = result.windowsApp.appId.toLowerCase();
        ensure(!windowsIds.has(windowsId), 'Application Windows en doublon.'); windowsIds.add(windowsId);
      }
      return result;
    } catch (error) { throw new Error(`applications[${index}] : ${error.message}`); }
  });
  ensure(config.commandAliases !== null, 'Liste de formulations invalide.');
  try {
    validateStore(config.commandAliases);
    for (const alias of config.commandAliases) {
      keys(alias, ['id', 'phrase', 'applicationId', 'action', 'arguments'], 'Formulation');
      ensure(UUID.test(alias.id), 'Identifiant de formulation invalide.');
      const app = config.applications.find(app => app.id === alias.applicationId);
      ensure(app, 'Une formulation référence une application inconnue.');
      ensure(alias.action === 'open' || (alias.action.startsWith('media_') && app.media) ||
        (alias.action.startsWith('deezer_') && app.media?.deezer && app.windowsApp?.appId === DEEZER_APP_ID), 'Une formulation référence une capacité non configurée.');
    }
  } catch (error) { throw new Error(`commandAliases : ${error.message}`); }
  ensure(Buffer.byteLength(JSON.stringify(config), 'utf8') <= MAX_CONFIG_BYTES, 'Profil trop volumineux (2 Mio maximum).');
  return config;
}

module.exports = { validateConfig, validateApplicationStructure, LANGUAGES, DEFAULT_CONFIG, MAX_CONFIG_BYTES, CURRENT_VERSION };
