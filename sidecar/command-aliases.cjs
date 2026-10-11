const {randomUUID} = require('node:crypto');
const {requestIssue} = require('./needle-tools.cjs');
const ACTIONS = new Set(['open','media_play','media_pause','media_next','media_previous','media_stop','media_toggle']);
const UUID = /^[0-9a-f-]{36}$/;
function ensure(condition,message) {if(!condition)throw new Error(message);}
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
  }
}
function findCommandAlias(text,config) {
  const key=normalizePhrase(text);
  return (config.commandAliases || []).find(alias=>normalizePhrase(alias.phrase)===key);
}
function saveCommandAlias(value,config,tools) {
  ensure(value && typeof value==='object' && !Array.isArray(value) &&
    Object.keys(value).every(key=>['id','phrase','applicationId','action'].includes(key)),'Formulation invalide.');
  ensure(typeof value.phrase==='string' && value.phrase.trim() && value.phrase.length<=200 && !/[\x00-\x1f]/u.test(value.phrase),'Formulation invalide (200 caractères maximum).');
  const phrase=value.phrase.trim(),key=normalizePhrase(phrase);
  ensure(key,'Renseignez une formulation complète.');
  const aliases=config.commandAliases || [];
  ensure(value.id===undefined || aliases.some(alias=>alias.id===value.id),'Formulation à modifier introuvable.');
  ensure(ACTIONS.has(value.action),'Choisissez une action de lancement ou de lecture.');
  const application=config.applications.find(app=>app.id===value.applicationId && app.enabled);
  ensure(application,'Choisissez une application active.');
  const tool=tools.find(tool=>tool.applicationId===application.id && tool.action===value.action);
  ensure(tool,'Cette action n’est pas configurée pour cette application.');
  const call={applicationId:application.id,action:value.action,arguments:{}};
  const issue=requestIssue(phrase,config,[call]) || requestIssue(key,config,[call]);
  ensure(!issue,issue);
  ensure(!aliases.some(alias=>alias.id!==value.id && normalizePhrase(alias.phrase)===key),'Cette formulation est déjà enregistrée. Modifiez son action dans Préférences.');
  const native=tools.filter(tool=>tool.triggers.some(pattern=>new RegExp(pattern,'i').test(phrase) || new RegExp(pattern,'i').test(key)));
  ensure(!native.length || native.every(item=>item.applicationId===application.id && item.action===value.action),
    'Cette formulation correspond déjà à une autre action. Choisissez la formulation mal transcrite.');
  ensure(value.id || aliases.length<64,'64 formulations maximum.');
  const alias={id:value.id || randomUUID(),phrase,applicationId:application.id,action:value.action};
  config.commandAliases=[...aliases.filter(item=>item.id!==alias.id),alias];
  return alias;
}
module.exports={ACTIONS,normalizePhrase,validateStore,findCommandAlias,saveCommandAlias};
