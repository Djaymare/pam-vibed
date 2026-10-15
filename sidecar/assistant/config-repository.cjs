// Profile persistence and application edits. The caller supplies the loaded fingerprint.
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { createConfigStore } = require('../config-store.cjs');
const { validateConfig, validateApplicationStructure, LANGUAGES } = require('../config-schema.cjs');
const { saveCommandAlias } = require('../command-aliases.cjs');
const { failure } = require('../diagnostics.cjs');
const { toolsFor } = require('./intent.cjs');
const { ensure } = require('./validation.cjs');
function configDigest(config) {
  const hash = createHash('sha256').update(JSON.stringify(config.applications));
  if (config.commandAliases?.length) hash.update(JSON.stringify(config.commandAliases));
  return hash.digest('hex');
}
async function validateApplication(value, existingId, checkAvailability = true) {
  const application = validateApplicationStructure(value, existingId);
  if (checkAvailability) {
    const available = await applicationAvailability(application);
    ensure(available.available, available.reason);
  }
  return application;
}
async function applicationAvailability(application) {
  try {
    if ((await fs.stat(application.executable)).isFile()) return { available: true };
  } catch {}
  return {
    available: false,
    reason: 'Exécutable indisponible. Réparez le chemin ou choisissez une autre application.',
  };
}
function createProfileRepository(directory, proposals) {
  const store = createConfigStore(directory);
  return {
    ...store,
    async save(value, { budget, fingerprint }) {
      const validated = validateConfig(value);
      await store.write(validated, { budget, expectedFingerprint: fingerprint });
      await proposals.reconcile(configDigest(validated));
    },
  };
}
const CONFIG_METHODS = new Set([
  'set_application_enabled',
  'save_application',
  'test_application',
  'delete_application',
  'save_command_alias',
  'delete_command_alias',
  'settings',
]);
async function editProfile(
  method,
  payload,
  config,
  { budget, saveConfig, launchApplication, context },
) {
  if (method === 'set_application_enabled') {
    ensure(typeof payload.enabled === 'boolean', 'État de l’application invalide.');
    const application = config.applications.find((app) => app.id === payload.id);
    ensure(application, 'Application à modifier introuvable.');
    if (payload.enabled) await validateApplication(application, application.id);
    application.enabled = payload.enabled;
    await saveConfig(config);
    return config;
  }
  if (method === 'save_application') {
    const id = payload.id;
    ensure(
      id === undefined || config.applications.some((app) => app.id === id),
      'Application à modifier introuvable.',
    );
    const previous = config.applications.find((app) => app.id === id);
    const application = validateApplicationStructure(payload, id);
    ensure(
      !config.applications.some(
        (app) =>
          app.id !== application.id && app.name.toLowerCase() === application.name.toLowerCase(),
      ),
      'Ce nom est déjà utilisé.',
    );
    ensure(
      !application.windowsApp ||
        !config.applications.some(
          (app) =>
            app.id !== application.id &&
            app.windowsApp?.appId.toLowerCase() === application.windowsApp.appId.toLowerCase(),
        ),
      'Cette application Windows est déjà ajoutée.',
    );
    ensure(id || config.applications.length < 32, '32 applications maximum pour ce prototype.');
    config.applications = [
      ...config.applications.filter((app) => app.id !== application.id),
      application,
    ];
    // Reference/schema errors retain PAM-05's deterministic precedence.
    validateConfig(config);
    if (!previous || payload.enabled || previous.executable !== payload.executable)
      await validateApplication(application, application.id);
    await saveConfig(config);
    return config;
  }
  if (method === 'test_application') {
    // Explicit user action on a draft. No inference, registration or approval
    // creation, and no arbitrary input from Needle is accepted here.
    const application = await validateApplication({
      ...payload,
      description: payload.description?.trim() || 'Tester le lancement.',
    });
    const needsInput = application.arguments.some((argument) => argument.includes('{input}'));
    ensure(
      payload.input === undefined ||
        (typeof payload.input === 'string' &&
          payload.input.length <= 2048 &&
          !payload.input.includes('\0')),
      'Texte du test invalide.',
    );
    ensure(
      !needsInput || payload.input?.trim(),
      'Renseignez le texte, le fichier ou l’URL à transmettre pour le test.',
    );
    try {
      const result = await budget.run(
        () =>
          launchApplication(application, needsInput ? { input: payload.input } : {}, { budget }),
        'test de lancement',
      );
      return {
        ...result,
        message: `Commande de lancement envoyée à ${application.name}. Vérifiez que l’application s’est ouverte.`,
      };
    } catch (error) {
      const diagnostic = failure(error, context, 'action_failure');
      return {
        applicationName: application.name,
        success: false,
        message: diagnostic.message,
        error: diagnostic,
      };
    }
  }
  if (method === 'delete_application') {
    ensure(
      config.applications.some((app) => app.id === payload.id),
      'Application introuvable.',
    );
    config.applications = config.applications.filter((app) => app.id !== payload.id);
    config.commandAliases = config.commandAliases.filter(
      (alias) => alias.applicationId !== payload.id,
    );
    await saveConfig(config);
    return config;
  }
  if (method === 'save_command_alias') {
    saveCommandAlias(payload, config, toolsFor(config));
    await saveConfig(config);
    return config;
  }
  if (method === 'delete_command_alias') {
    ensure(
      config.commandAliases.some((alias) => alias.id === payload.id),
      'Formulation introuvable.',
    );
    config.commandAliases = config.commandAliases.filter((alias) => alias.id !== payload.id);
    await saveConfig(config);
    return config;
  }
  if (method === 'settings') {
    ensure(LANGUAGES.has(payload.language), 'Langue invalide.');
    ensure(typeof payload.autoExecute === 'boolean', 'Préférence d’exécution invalide.');
    ensure(
      Number.isFinite(payload.confidenceThreshold) &&
        payload.confidenceThreshold >= 0.1 &&
        payload.confidenceThreshold <= 1,
      'Seuil de confiance invalide.',
    );
    Object.assign(config, {
      language: payload.language,
      autoExecute: payload.autoExecute,
      confidenceThreshold: payload.confidenceThreshold,
    });
    await saveConfig(config);
    return config;
  }
}
module.exports = {
  createProfileRepository,
  editProfile,
  CONFIG_METHODS,
  configDigest,
  applicationAvailability,
};
