// Shared catalogue, not an authority to launch. Native validation is independent.
const registry = require('./action-registry.json');
const ACTIONS = Object.fromEntries(registry.actions.map(action => [action.id, action]));
const MEDIA_ACTIONS = Object.fromEntries(registry.actions.filter(a => a.family === 'media').map(a => [a.nativeAction, a.executionLabel]));
function parameterSchema(action) {
  const schema = structuredClone(ACTIONS[action].parameters);
  for (const property of Object.values(schema.properties)) {
    if (property.options) {
      property.enum = Object.keys(registry.options[property.options]);
      delete property.options;
    }
    delete property.trim;
    delete property.rejectControls;
    delete property.error;
    delete property.label;
    delete property.help;
    delete property.inputmode;
  }
  return schema;
}
function validateArguments(action, args = {}) {
  const definition = Object.hasOwn(ACTIONS, action) && ACTIONS[action];
  if (!definition || !args || typeof args !== 'object' || Array.isArray(args)) throw Error('Action ou paramètres inconnus.');
  const schema = definition.parameters, result = {};
  if (Object.keys(args).some(key => !Object.hasOwn(schema.properties, key))) throw Error('Argument Deezer non autorisé.');
  for (const [key, property] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(args, key)) {
      if (schema.required.includes(key)) throw Error(definition.argumentError || 'Paramètre requis.');
      continue;
    }
    const value = args[key];
    if (typeof value !== 'string' ||
        property.options && !Object.hasOwn(registry.options[property.options], value) ||
        property.pattern && !(new RegExp(property.pattern)).test(value) ||
        property.minLength && (property.trim ? value.trim() : value).length < property.minLength ||
        property.maxLength && value.length > property.maxLength ||
        property.rejectControls && /[\x00-\x1f]/u.test(value)) throw Error(property.error || definition.argumentError || 'Paramètre invalide.');
    result[key] = property.trim ? value.trim() : value;
  }
  return result;
}
function routePath(action, args) {
  const definition = Object.hasOwn(ACTIONS, action) && ACTIONS[action];
  if (!definition || definition.family !== 'deezer') throw Error('Action Deezer inconnue.');
  const valid = validateArguments(action, args), route = definition.route;
  switch (route.kind) {
    case 'option': return registry.options[route.options][valid[route.parameter]].path;
    case 'fixed': return route.path;
    case 'search': return `search/${encodeURIComponent(valid.query)}`;
    case 'content': return `${valid.kind}/${valid.id}`;
    case 'selection': return `smarttracklist/${valid.id}${valid.mode === 'play' ? '?autoplay=true' : ''}`;
    default: throw Error('Route Deezer inconnue.');
  }
}
module.exports = {registry, ACTIONS, MEDIA_ACTIONS, parameterSchema, validateArguments, routePath};
