// Inventory and evidence: docs/windows-media-deezer.md. Only established routes.
const DEEZER_APP_ID = 'Deezer.62021768415AF_q7m17pa7q8kj0!Deezer.Music';
// Deezer Music 8.0.0.0 publishes Deezer.exe on the tested Windows installation.
const DEEZER_SOURCE_IDS = [DEEZER_APP_ID, 'Deezer.exe'];
const CONTENT = ['track', 'album', 'artist', 'playlist', 'show', 'episode', 'profile'];
const PAGE_PATHS = {home:'',podcasts:'podcasts',explore:'channels/explore',charts:'channels/charts',moods:'channels/moods',radios:'channels/radios',audio_settings:'settings/audio',theme:'settings/app_theme'};
const PAGES = Object.keys(PAGE_PATHS);
function fail(message) { throw new Error(message); }
function contentUri(kind, id) {
  if (!CONTENT.includes(kind)) fail('Type de contenu Deezer non autorisé.');
  if (typeof id !== 'string' || !/^[1-9][0-9]{0,18}$/.test(id)) fail('Identifiant Deezer invalide : utilisez un identifiant numérique positif.');
  return `deezer://www.deezer.com/${kind}/${id}`;
}
function searchUri(query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 200 || /[\x00-\x1f]/.test(query)) fail('Recherche Deezer invalide.');
  return `deezer://www.deezer.com/search/${encodeURIComponent(query.trim())}`;
}
function validateDeezerArgs(action, args) {
  if (action === 'deezer_content') {
    if (Object.keys(args).some(key => !['kind','id'].includes(key))) fail('Argument Deezer non autorisé.');
    contentUri(args.kind, args.id); return {kind:args.kind,id:args.id};
  }
  if (action === 'deezer_search') {
    if (Object.keys(args).some(key => key !== 'query')) fail('Argument Deezer non autorisé.');
    searchUri(args.query); return {query:args.query.trim()};
  }
  if (action === 'deezer_page') {
    if (Object.keys(args).some(key => key !== 'page') || !PAGES.includes(args.page)) fail('Page Deezer non autorisée.');
    return {page:args.page};
  }
  if (action === 'deezer_reload') {
    if (Object.keys(args).length) fail('Le rechargement Deezer n’accepte aucun argument.');
    return {};
  }
  if (action === 'deezer_start') {
    if (Object.keys(args).some(key => key !== 'mix') || !['flow','loved_tracks'].includes(args.mix)) fail('Mix Deezer non autorisé.');
    return {mix:args.mix};
  }
  if (action === 'deezer_smarttracklist') {
    if (Object.keys(args).some(key => !['id','mode'].includes(key)) ||
      typeof args.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(args.id) || !['display','play'].includes(args.mode)) fail('Sélection Deezer invalide.');
    return {id:args.id,mode:args.mode};
  }
  fail('Action Deezer inconnue.');
}
function deezerUri(action,args) {
  const valid = validateDeezerArgs(action,args);
  if (action === 'deezer_content') return contentUri(valid.kind,valid.id);
  if (action === 'deezer_search') return searchUri(valid.query);
  if (action === 'deezer_reload') return 'deezer://www.deezer.com/reload';
  if (action === 'deezer_start') return `deezer://www.deezer.com/user/me/${valid.mix === 'flow' ? 'flow' : 'tracks'}`;
  if (action === 'deezer_smarttracklist') return `deezer://www.deezer.com/smarttracklist/${valid.id}${valid.mode === 'play' ? '?autoplay=true' : ''}`;
  return 'deezer://www.deezer.com/' + PAGE_PATHS[valid.page];
}
module.exports = { DEEZER_APP_ID, DEEZER_SOURCE_IDS, CONTENT, PAGES, contentUri, searchUri, validateDeezerArgs, deezerUri };
