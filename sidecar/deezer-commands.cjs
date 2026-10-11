const {DEEZER_APP_ID,validateDeezerArgs} = require('./deezer.cjs');
const PAGE_LABELS={home:'l’accueil',podcasts:'les podcasts',explore:'Explorer',charts:'les classements',moods:'les ambiances',radios:'les radios',audio_settings:'les réglages audio',theme:'l’apparence'};
const CONTENT_LABELS={track:'la chanson',album:'l’album',artist:'l’artiste',playlist:'la playlist',show:'le podcast',episode:'l’épisode',profile:'le profil'};
const normalize=text=>text.normalize('NFKD').replace(/\p{M}/gu,'').replace(/œ/g,'oe').replace(/’/g,"'").toLowerCase().trim().replace(/\s+/g,' ');
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/ /g,'\\s+');
function parseCommand(command) {
  const text=normalize(command);
  const playback='(?:demarre[r]?|lance[r]?|joue[r]?|ecoute[r]?|lis|lire)';
  if(new RegExp(`^${playback}\\s+(?:(?:le|les|mes)\\s+)?flow$`).test(text))return {action:'deezer_start',arguments:{mix:'flow'}};
  if(new RegExp(`^${playback}\\s+(?:(?:le|les|mes)\\s+)?(?:coups?|couts?)\\s+de\\s+coeur$`).test(text))return {action:'deezer_start',arguments:{mix:'loved_tracks'}};
  if(/^(?:recharge[r]?|reload)$/.test(text))return {action:'deezer_reload',arguments:{}};
  const search=/^(?:cherche[r]?|recherche[r]?)\s+(.+)$/iu.exec(command);
  if(search && !/\b(?:et|puis|and|then)\s+(?:ne\s+|n['’]|ouvre|lance|demarre|joue|recharge)/u.test(normalize(search[1])))
    return {action:'deezer_search',arguments:validateDeezerArgs('deezer_search',{query:search[1].trim()})};
  const content=/^(?:affiche[r]?|ouvre|ouvrir)\s+(?:(?:la|le|un|une)\s+|l['’])?(chanson|titre|track|album|artiste|artist|playlist|podcast|show|[ée]pisode|episode|profil|profile)\s+([1-9][0-9]{0,18})$/iu.exec(command);
  if(content) {
    const kind={chanson:'track',titre:'track',track:'track',album:'album',artiste:'artist',artist:'artist',playlist:'playlist',podcast:'show',show:'show',episode:'episode',profil:'profile',profile:'profile'}[normalize(content[1])];
    return {action:'deezer_content',arguments:{kind,id:content[2]}};
  }
  const selection=/^(affiche[r]?|ouvre|ouvrir|d[eé]marre[r]?|lance[r]?|joue[r]?|lis|lire)\s+(?:(?:la|une)\s+)?(?:s[eé]lection\s+)?smarttracklist\s+([A-Za-z0-9_-]{1,80})$/iu.exec(command);
  if(selection)return {action:'deezer_smarttracklist',arguments:{id:selection[2],mode:/^(?:affiche|ouvre|ouvrir)/u.test(normalize(selection[1]))?'display':'play'}};
  const page=/^(?:affiche[r]?|ouvre|ouvrir)\s+(?:(?:la|le|les|un|une)\s+|l')?(?:page\s+(?:(?:la|le|les|de|des)\s+|l')?)?(.+)$/u.exec(text);
  if(page) {
    const key={accueil:'home',podcasts:'podcasts',explorer:'explore',exploration:'explore',classements:'charts',ambiances:'moods',radios:'radios',
      'reglages audio':'audio_settings','parametres audio':'audio_settings',apparence:'theme',"reglages d'apparence":'theme',theme:'theme'}[page[1]];
    if(key)return {action:'deezer_page',arguments:{page:key}};
  }
  return null;
}
function recognizeDeezerCommand(transcript,config) {
  const matches=[];
  for(const app of config.applications.filter(app=>app.enabled && app.media?.deezer && app.windowsApp?.appId===DEEZER_APP_ID)) {
    const names=[...new Set([app.name,...app.aliases].flatMap(name=>[name,normalize(name)]))].filter(name=>!config.applications.some(other=>other.enabled && other.id!==app.id && [other.name,...other.aliases].some(label=>normalize(label)===normalize(name))));
    for(const name of names) {
      // Preserve query and ID bytes; normalization is only for control words.
      const match=new RegExp(`^(.+?)\\s+(?:(?:dans|sur|de)\\s+)?${escape(name)}\\s*[.!?]*\\s*$`,'iu').exec(transcript.trim());
      if(!match)continue;
      const parsed=parseCommand(match[1].trim());
      if(parsed)matches.push({...parsed,applicationId:app.id});
    }
  }
  const unique=[...new Map(matches.map(match=>[JSON.stringify(match),match])).values()];
  return unique.length===1 ? unique[0] : null;
}
function boundCommand(tool,label) {
  const args=tool.boundArguments;
  if(!args)return null;
  const pages={home:'home page',podcasts:'podcasts page',explore:'explore page',charts:'charts page',moods:'moods page',radios:'radios page',audio_settings:'audio settings',theme:'appearance settings'};
  const kinds={track:'track',album:'album',artist:'artist',playlist:'playlist',show:'podcast',episode:'episode',profile:'profile'};
  if(tool.action==='deezer_start')return args.mix==='flow' ? {key:'flow',prompt:`Start Flow in ${label}`} : {key:'favorites',prompt:`Play liked songs in ${label}`};
  if(tool.action==='deezer_page')return {key:args.page,prompt:`Open the ${label} ${pages[args.page]}`};
  if(tool.action==='deezer_search')return {key:'search',prompt:`Search ${label}`};
  if(tool.action==='deezer_content')return {key:`show_${args.kind}`,prompt:`Show a ${kinds[args.kind]} in ${label}`};
  if(tool.action==='deezer_reload')return {key:'reload',prompt:`Reload ${label}`};
  if(tool.action==='deezer_smarttracklist')return {key:args.mode==='play'?'play_selection':'show_selection',prompt:`${args.mode==='play'?'Play':'Show'} a selection in ${label}`};
  return null;
}
function deezerActionLabel(action,args) {
  if(action==='deezer_start')return args.mix==='flow'?'Démarrer Flow':'Lire les coups de cœur';
  if(action==='deezer_search')return `Rechercher « ${args.query} »`;
  if(action==='deezer_content')return `Afficher ${CONTENT_LABELS[args.kind]} ${args.id}`;
  if(action==='deezer_page')return `Afficher ${PAGE_LABELS[args.page]}`;
  if(action==='deezer_reload')return 'Recharger';
  if(action==='deezer_smarttracklist')return `${args.mode==='play'?'Lire':'Afficher'} la sélection ${args.id}`;
}
module.exports={recognizeDeezerCommand,boundCommand,deezerActionLabel};
