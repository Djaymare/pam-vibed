const {DEEZER_APP_ID,validateDeezerArgs} = require('./deezer.cjs');
const {registry} = require('./action-registry.cjs');
const optionField=(options,field)=>Object.fromEntries(Object.entries(options).map(([key,value])=>[key,value[field]]));
const PAGE_LABELS=optionField(registry.options.pages,'spokenLabel');
const CONTENT_LABELS=optionField(registry.options.contents,'spokenLabel');
const optionAliases=options=>Object.fromEntries(Object.entries(options).flatMap(([key,value])=>value.aliases.map(alias=>[alias,key])));
const PAGE_ALIASES=optionAliases(registry.options.pages);
const CONTENT_ALIASES=optionAliases(registry.options.contents);
const normalize=text=>text.normalize('NFKD').replace(/\p{M}/gu,'').replace(/œ/g,'oe').replace(/’/g,"'").toLowerCase().trim().replace(/\s+/g,' ');
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/ /g,'\\s+');
const PLAYBACK='(?:demarre[r]?|lance[r]?|joue[r]?|ecoute[r]?|lis|lire)';
const FLOW=new RegExp(`^${PLAYBACK}\\s+(?:(?:le|les|mes)\\s+)?flow$`);
function parseFlow(command,short=false) {
  const text=normalize(command).replace(/[.!?]+$/u,'').trim();
  return FLOW.test(text) || short && text==='flow' ? {action:'deezer_start',arguments:{mix:'flow'}} : null;
}
function parseCommand(command) {
  const text=normalize(command);
  if(FLOW.test(text))return {action:'deezer_start',arguments:{mix:'flow'}};
  if(new RegExp(`^${PLAYBACK}\\s+(?:(?:le|les|mes)\\s+)?(?:coups?|couts?)\\s+de\\s+coeur$`).test(text))return {action:'deezer_start',arguments:{mix:'loved_tracks'}};
  if(/^(?:recharge[r]?|reload)$/.test(text))return {action:'deezer_reload',arguments:{}};
  const search=/^(?:cherche[r]?|recherche[r]?)\s+(.+)$/iu.exec(command);
  if(search && !/\b(?:et|puis|and|then)\s+(?:ne\s+|n['’]|ouvre|lance|demarre|joue|recharge)/u.test(normalize(search[1])))
    return {action:'deezer_search',arguments:validateDeezerArgs('deezer_search',{query:search[1].trim()})};
  const content=new RegExp(`^(?:affiche[r]?|ouvre|ouvrir)\\s+(?:(?:la|le|un|une)\\s+|l['’])?(${Object.keys(CONTENT_ALIASES).map(escape).join('|')})\\s+([1-9][0-9]{0,18})$`,'iu').exec(normalize(command));
  if(content) {
    const kind=CONTENT_ALIASES[normalize(content[1])];
    return {action:'deezer_content',arguments:{kind,id:content[2]}};
  }
  const selection=/^(affiche[r]?|ouvre|ouvrir|d[eé]marre[r]?|lance[r]?|joue[r]?|lis|lire)\s+(?:(?:la|une)\s+)?(?:s[eé]lection\s+)?smarttracklist\s+([A-Za-z0-9_-]{1,80})$/iu.exec(command);
  if(selection)return {action:'deezer_smarttracklist',arguments:{id:selection[2],mode:/^(?:affiche|ouvre|ouvrir)/u.test(normalize(selection[1]))?'display':'play'}};
  const page=/^(?:affiche[r]?|ouvre|ouvrir)\s+(?:(?:la|le|les|un|une)\s+|l')?(?:page\s+(?:(?:la|le|les|de|des)\s+|l')?)?(.+)$/u.exec(text);
  if(page) {
    const key=Object.hasOwn(PAGE_ALIASES,page[1]) && PAGE_ALIASES[page[1]];
    if(key)return {action:'deezer_page',arguments:{page:key}};
  }
  return null;
}
function parseNamedCommand(command) {
  const parsed=parseCommand(command) || parseCommand(command.replace(/[.!?]+\s*$/u,'').trim());
  if(parsed)return parsed;
  // A selection name is an order only next to an explicit Deezer name.
  const text=normalize(command).replace(/[.!?]+$/u,'').trim();
  if(text==='flow')return parseFlow(command,true);
  if(/^(?:(?:les|mes)\s+)?(?:coups?|couts?)\s+de\s+coeur$/u.test(text))
    return {action:'deezer_start',arguments:{mix:'loved_tracks'}};
  return null;
}
function resolveDeezerCommand(transcript,config) {
  const applications=config.applications.filter(app=>app.enabled && app.media?.deezer && app.windowsApp?.appId===DEEZER_APP_ID);
  const matches=[];
  let sharedName=false,unavailableFlow=false;
  for(const app of config.applications) {
    const eligible=applications.includes(app);
    const names=[...new Set([app.name,...app.aliases].flatMap(name=>[name,normalize(name)]))];
    for(const name of names) {
      // Preserve query and ID bytes; normalization is only for control words.
      const patterns=[
        `^(.+?)\\s+(?:(?:dans|sur|de)\\s+)?${escape(name)}\\s*[.!?]*\\s*$`,
        `^(?:(?:dans|sur)\\s+)?${escape(name)}(?:\\s*[:,]\\s*|\\s+)(.+?)\\s*$`,
      ];
      for(const pattern of patterns) {
        const match=new RegExp(pattern,'iu').exec(transcript.trim());
        if(!match)continue;
        const parsed=eligible ? parseNamedCommand(match[1].trim()) : parseFlow(match[1].trim(),true);
        if(!parsed)continue;
        if(!eligible) {unavailableFlow=true;continue;}
        sharedName ||= config.applications.some(other=>other.enabled && other.id!==app.id && [other.name,...other.aliases].some(label=>normalize(label)===normalize(name)));
        matches.push({...parsed,applicationId:app.id});
      }
    }
  }
  const unique=[...new Map(matches.map(match=>[JSON.stringify(match),match])).values()];
  if(sharedName || unique.length>1)return {issue:'Ce nom désigne plusieurs applications. Précisez le nom ou un alias unique du lecteur Deezer souhaité.'};
  if(unique.length===1)return {command:unique[0]};
  if(unavailableFlow)return {issue:'Le lecteur nommé ne propose pas Flow. Cette fonction nécessite le plugin Deezer Music actif sur le lecteur demandé.'};
  const command=transcript.trim().replace(/[.!?]+\s*$/u,'').trim();
  const implicit=parseFlow(command);
  // Flow belongs to Deezer. Other commands still require an explicit target.
  // An application actually named Flow keeps its ordinary launch command.
  const namesApplication=config.applications.some(app=>app.enabled && [app.name,...app.aliases].some(name=>['flow',normalize(command)].includes(normalize(name))));
  if(implicit?.action==='deezer_start' && implicit.arguments.mix==='flow' && !namesApplication) {
    if(applications.length===1)return {command:{...implicit,applicationId:applications[0].id}};
    return {issue:applications.length ? 'Plusieurs applications Deezer peuvent démarrer Flow. Précisez le nom ou un alias du lecteur souhaité.' :
      'Flow nécessite une application active avec le plugin Deezer Music. Activez le plugin dans sa fiche.'};
  }
  return {};
}
function recognizeDeezerCommand(transcript,config) {
  return resolveDeezerCommand(transcript,config).command || null;
}
function deezerCommandIssue(transcript,config) {
  return resolveDeezerCommand(transcript,config).issue || null;
}
function boundCommand(tool,label) {
  const args=tool.boundArguments;
  if(!args)return null;
  const pages=optionField(registry.options.pages,'promptLabel');
  const kinds=optionField(registry.options.contents,'promptLabel');
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
module.exports={recognizeDeezerCommand,deezerCommandIssue,boundCommand,deezerActionLabel};
