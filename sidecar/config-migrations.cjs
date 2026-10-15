const { validateConfig, CURRENT_VERSION } = require('./config-schema.cjs');

// Migrations consume validated versions without mutating or persisting inputs.
const MIGRATIONS = Object.freeze({
  1: config => ({ ...config, version: 2, commandAliases: config.commandAliases ?? [] }),
});
function migrateConfig(value, migrations = MIGRATIONS) {
  let config = validateConfig(value);
  while (config.version < CURRENT_VERSION) {
    const version = config.version, migrate = migrations[version];
    if (typeof migrate !== 'function') throw new Error(`Migration ${version} indisponible. Conservez l’original et restaurez une sauvegarde avec une version de PAM compatible.`);
    try {
      config = migrate(structuredClone(config));
      if (config?.version !== version + 1) throw new Error('Version de sortie incorrecte.');
      config = validateConfig(config);
    } catch (error) {
      throw new Error(`Migration ${version} → ${version + 1} échouée : ${error.message} Conservez l’original et restaurez une sauvegarde ou utilisez la version précédente de PAM.`);
    }
  }
  return config;
}
module.exports = { migrateConfig, MIGRATIONS };
