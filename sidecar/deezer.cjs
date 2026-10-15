// Only established routes. See docs/windows-media-deezer.md and action-registry.md.
const {registry, ACTIONS, validateArguments, routePath} = require('./action-registry.cjs');
const DEEZER_APP_ID = registry.deezer.appId;
const DEEZER_SOURCE_IDS = registry.deezer.sourceIds;
const CONTENT = Object.keys(registry.options.contents);
const PAGES = Object.keys(registry.options.pages);
function validateDeezerArgs(action, args) {
  if (!Object.hasOwn(ACTIONS, action) || ACTIONS[action].family !== 'deezer') throw Error('Action Deezer inconnue.');
  return validateArguments(action, args);
}
function deezerUri(action, args) {
  return registry.deezer.protocols[0] + '://' + registry.deezer.host + '/' + routePath(action, args);
}
const contentUri = (kind, id) => deezerUri('deezer_content', {kind, id});
const searchUri = query => deezerUri('deezer_search', {query});
module.exports = {DEEZER_APP_ID, DEEZER_SOURCE_IDS, CONTENT, PAGES, contentUri, searchUri, validateDeezerArgs, deezerUri};
