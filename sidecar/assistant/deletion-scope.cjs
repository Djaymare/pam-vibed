const { createHash } = require('node:crypto');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function deletionFingerprint(config, kind, id) {
  const alias = config.commandAliases.find((item) => item.id === id);
  const application = config.applications.find(
    (item) => item.id === (kind === 'application' ? id : alias?.applicationId),
  );
  const scope = {
    kind,
    id,
    application,
    aliases:
      kind === 'application'
        ? config.commandAliases.filter((item) => item.applicationId === id)
        : [alias],
  };
  return createHash('sha256').update(canonical(scope)).digest('hex');
}
module.exports = { deletionFingerprint };
