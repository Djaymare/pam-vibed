const {randomUUID} = require('node:crypto');
const {requestIssue} = require('./needle-tools.cjs');
const {validateDeezerArgs} = require('./deezer.cjs');
const {recognizeDeezerCommand} = require('./deezer-commands.cjs');
const {resolveMediaCommand} = require('./media-commands.cjs');
const ACTIONS = new Set(Object.keys(require('./action-registry.cjs').ACTIONS));
const UUID = /^[0-9a-f-]{36}$/;
function ensure(condition,message) {if(!condition)throw new Error(message);}
function aliasArguments(action,args) {
  ensure(args===undefined || (args && typeof args==='object' && !Array.isArray(args)),'Paramètres de formulation invalides.');
  if(action.startsWith('deezer_'))return validateDeezerArgs(action,args || {});
  ensure(!args || Object.keys(args).length===0,'Cette action ne mémorise aucun paramètre.');
  return {};
}
function normalizePhrase(phrase) {
  return phrase.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/’/g,"'")
    .trim().replace(/[.!?]+$/u,'').trim().replace(/\s+/g,' ');
}
function validateStore(aliases) {
  ensure(Array.isArray(aliases) && aliases.length<=64,'Liste de formulations incompatible (64 maximum).');
  const ids=new Set(),phrases=new Set();
  for(const alias of aliases) {
    ensure(alias && UUID.test(alias.id) && typeof alias.phrase==='string' && alias.phrase.trim() && alias.phrase.length<=200 &&
      !/[\x00-\x1f]/u.test(alias.phrase) && typeof alias.applicationId==='string' && ACTIONS.has(alias.action),'Formulation enregistrée invalide.');
    const phrase=normalizePhrase(alias.phrase);
    ensure(phrase && !ids.has(alias.id) && !phrases.has(phrase),'Formulations enregistrées en doublon.');
    ids.add(alias.id);phrases.add(phrase);
    aliasArguments(alias.action,alias.arguments);
  }
}
function findCommandAlias(text,config) {
  const key=normalizePhrase(text);
  return (config.commandAliases || []).find(alias=>normalizePhrase(alias.phrase)===key);
}
function saveCommandAlias(value,config,tools) {
  ensure(value && typeof value==='object' && !Array.isArray(value) &&
    Object.keys(value).every(key=>['id','phrase','applicationId','action','arguments'].includes(key)),'Formulation invalide.');
  ensure(typeof value.phrase==='string' && value.phrase.trim() && value.phrase.length<=200 && !/[\x00-\x1f]/u.test(value.phrase),'Formulation invalide (200 caractères maximum).');
  const phrase=value.phrase.trim(),key=normalizePhrase(phrase);
  ensure(key,'Renseignez une formulation complète.');
  const aliases=config.commandAliases || [];
  ensure(value.id===undefined || aliases.some(alias=>alias.id===value.id),'Formulation à modifier introuvable.');
  ensure(ACTIONS.has(value.action),'Choisissez une action de lancement ou de lecture.');
  const args=aliasArguments(value.action,value.arguments);
  const application=config.applications.find(app=>app.id===value.applicationId && app.enabled);
  ensure(application,'Choisissez une application active.');
  const tool=tools.find(tool=>tool.applicationId===application.id && tool.action===value.action);
  ensure(tool,'Cette action n’est pas configurée pour cette application.');
  ensure(!value.action.startsWith('deezer_') || !/(?:ajout|ins[eè]r|programme).*?(?:file|queue|en\s+prochain)|(?:joue|jouer|lance|lancer|[ée]coute|[ée]couter|lis|lire|play)\s+(?:(?:la|le|une?|the)\s+)?(?:chanson|titre|morceau|piste|song|track)\s+(?!suivant|pr[eé]c[eé]dent|next|previous)/iu.test(phrase),
    'La lecture d’une chanson précise et son insertion dans la file ne disposent pas de protocole Deezer vérifié.');
  const call={applicationId:application.id,action:value.action,arguments:{}};
  const approved={applicationId:application.id,action:value.action};
  const issue=requestIssue(phrase,config,[call],undefined,approved) || requestIssue(key,config,[call],undefined,approved);
  ensure(!issue,issue);
  ensure(!aliases.some(alias=>alias.id!==value.id && normalizePhrase(alias.phrase)===key),'Cette formulation est déjà enregistrée. Modifiez son action dans Préférences.');
  const native=tools.filter(tool=>tool.triggers.some(pattern=>new RegExp(pattern,'i').test(phrase) || new RegExp(pattern,'i').test(key)));
  ensure(!native.length || native.every(item=>item.applicationId===application.id && item.action===value.action),
    'Cette formulation correspond déjà à une autre action. Choisissez la formulation mal transcrite.');
  const recognized=recognizeDeezerCommand(phrase,config);
  const media=resolveMediaCommand(phrase,config);
  ensure(!media.applicationId || media.personalizable || media.applicationId===application.id && media.action===value.action,
    'Cette formulation correspond déjà à une autre action multimédia. Choisissez la formulation mal transcrite.');
  const fixed={deezer_start:'mix',deezer_page:'page',deezer_content:'kind',deezer_smarttracklist:'mode'}[value.action];
  ensure(!recognized || (recognized.applicationId===application.id && recognized.action===value.action && (!fixed || recognized.arguments[fixed]===args[fixed])),
    'Cette formulation correspond déjà à une autre action Deezer. Choisissez la formulation mal transcrite.');
  ensure(value.id || aliases.length<64,'64 formulations maximum.');
  const alias={id:value.id || randomUUID(),phrase,applicationId:application.id,action:value.action,...(value.action.startsWith('deezer_')?{arguments:args}:{})};
  config.commandAliases=[...aliases.filter(item=>item.id!==alias.id),alias];
  return alias;
}
module.exports={ACTIONS,normalizePhrase,validateStore,findCommandAlias,saveCommandAlias};
