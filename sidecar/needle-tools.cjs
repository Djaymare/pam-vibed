const {ACTIONS} = require('./action-registry.cjs');
const { createHash } = require('node:crypto');
const {boundCommand,recognizeDeezerCommand} = require('./deezer-commands.cjs');
const {DEEZER_APP_ID} = require('./deezer.cjs');
const {resolveMediaCommand} = require('./media-commands.cjs');

// Model-facing names are independent of persisted action names and approvals.
function modelLabel(application) {
  if(application.media?.deezer && application.windowsApp?.appId===DEEZER_APP_ID)return 'Deezer Music';
  return application.name.replace(/^(?:navigateur|browser)\s+/i, '').normalize('NFKD')
    .replace(/\p{M}/gu, '').trim() || 'application';
}
function needleToolName(tool, config) {
  // Keep the established Deezer schemas: their ID/query grounding was verified
  // with these names and descriptions. This optimization concerns app/media verbs.
  if (tool.action.startsWith('deezer_') && !tool.boundArguments) return tool.name;
  const application = config.applications.find(app => app.id === tool.applicationId);
  const slug = app => modelLabel(app).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'application';
  const target = slug(application);
  const duplicate = config.applications.some(app => app.enabled && app.id !== application.id && slug(app) === target);
  const suffix = duplicate ? `_${createHash('sha256').update(application.id).digest('hex').slice(0, 8)}` : '';
  return `${boundCommand(tool,modelLabel(application))?.key || tool.action.replace(/^media_/, '')}_${target}${suffix}`;
}
function needleTools(tools, config) {
  return tools.map(tool => {
    const app = config.applications.find(app => app.id === tool.applicationId);
    const bound = boundCommand(tool,modelLabel(app));
    if(bound)return {name:needleToolName(tool,config),description:`${bound.prompt}.`,
      parameters:{type:'object',properties:{},required:[],additionalProperties:false}};
    if (tool.action.startsWith('deezer_')) {
      const {name, description, triggers, parameters} = tool;
      return {name, description, triggers, parameters};
    }
    const application = config.applications.find(app => app.id === tool.applicationId);
    const label = modelLabel(application);
    // A browser label is useful for Opera; other media applications are players.
    let description = ACTIONS[tool.action]?.modelDescription?.replaceAll('{label}', label).replaceAll('{description}', application.description) ?? tool.description;
    if (!/navigateur|browser|opera|chrome|firefox|edge/i.test(application.name)) description = description.replace(' browser.', ' player.');
    return {name: needleToolName(tool, config), description: `${description} Aliases: ${[application.name, ...application.aliases].join(', ')}.`,
      triggers: tool.triggers, parameters: tool.parameters};
  });
}
function canonicalPrompt(tool, application) {
  const bound=boundCommand(tool,modelLabel(application));
  if(bound)return bound.prompt;
  const label = modelLabel(application);
  return ACTIONS[tool.action]?.canonicalPrompt?.replaceAll('{label}', label);
}
function labels(application) {
  return [...new Set([application.name, ...application.aliases].map(label => label.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ')))];
}
function requestIssue(text, config, calls, selectedApplicationId,approvedCommand) {
  const { strings } = require('./languages.cjs');
  const normalized = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’]/g, "'");
  const names=config.applications.flatMap(labels).map(label=>label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/ /g,'\\s+')).sort((a,b)=>b.length-a.length);
  const targetPrefix=names.length ? new RegExp(`^\\s*(?:(?:dans|sur)\\s+)?(?:${names.join('|')})(?:\\s*[:,]\\s*|\\s+)`,'u') : null;
  // Refuse a leading negation, including one in a compound command clause.
  // Quoted text and explicit input values are data, not command clauses.
  let commandText = normalized.replace(/«[^»]*»|"[^"]*"|“[^”]*”/gu, ' ');
  const transmission = /\b(?:avec\s+(?:le\s+)?texte|with\s+(?:the\s+)?text)\b/u.exec(normalized);
  if (transmission && calls.some(call => typeof call.arguments?.input === 'string' && call.arguments.input.trim()))
    commandText = normalized.slice(0, transmission.index);
  const directCommand=targetPrefix ? commandText.replace(targetPrefix,'') : commandText;
  if (/(?:^\s*|\b(?:et|puis|mais|and|then|but)\s+)(?:(?:surtout|merci de)\s+)?(?:ne\s+|n'|don't\s+|do not\s+|never\s+|(?:joue|ouvre|lance|reprends|mets|arrete|demarre|passe|passer|pause|pauser|stoppe|stopper|bascule)\s+pas\b)/u.test(directCommand))
    return strings.negation;
  const directOriginal=targetPrefix ? normalized.replace(targetPrefix,'') : normalized;
  if (/^\s*(?:(?:elle|il|on)\s+(?:a dit|dit|a demande|a ecrit)|(?:she|he|they)\s+(?:said|says|asked|wrote))\b/u.test(directOriginal) || /^\s*[«"“]/u.test(directOriginal))
    return strings.quoted;
  const mentioned = config.applications.filter(app => labels(app).some(label => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped.replace(/ /g, '\\s+')}(?:$|[^\\p{L}\\p{N}])`, 'u').test(normalized);
  }));
  if (!selectedApplicationId && calls.some(call => !call.action || call.action === 'open') &&
      (mentioned.length > 1 && /\b(?:ou|or)\b/u.test(commandText) || mentioned.length > 1 && mentioned.some(app =>
        mentioned.some(other => other.id !== app.id && labels(app).some(label => labels(other).includes(label) && normalized.includes(label))))))
    return strings.ambiguous;
  if (!selectedApplicationId && mentioned.length && calls.some(call => !mentioned.some(app => app.id === call.applicationId)))
    return 'L’application proposée ne correspond pas à celle nommée dans votre demande. Précisez son nom ou son alias.';
  const deezer=recognizeDeezerCommand(text,config);
  const knownDeezer=deezer && calls.length>0 && calls.every(call=>call.applicationId===deezer.applicationId && call.action===deezer.action);
  const approved=approvedCommand && calls.length>0 && calls.every(call=>call.applicationId===approvedCommand.applicationId && (call.action || 'open')===approvedCommand.action);
  let knownMedia=false;
  if(!knownDeezer && !approved) {
    const media=resolveMediaCommand(text,config,undefined,selectedApplicationId);
    if(media.issue)return media.issue;
    if(media.action && calls.some(call=>call.action!==media.action))return 'L’action proposée ne correspond pas à la commande multimédia demandée.';
    knownMedia=media.action && calls.length>0 && calls.every(call=>call.action===media.action && (!media.applicationId || call.applicationId===media.applicationId));
    const launch=/\b(?:ouvre|ouvrez|ouvrir|lance|lancez|lancer|demarre|demarrer|open|launch|start)\b/u.test(commandText);
    const mediaClue=/\b(?:lecture|play|joue|jouer|pause|pose|pauser|pauiser|reprends|reprendre|stop|arrete|arreter|bascule|suivante?|prochaine?|precedente?|next|previous)\b/u.test(commandText);
    if(calls.some(call=>(!call.action || call.action==='open') && call.applicationId!==selectedApplicationId && !launch && !labels(config.applications.find(app=>app.id===call.applicationId)).includes(normalized.trim().replace(/[.!?]+$/u,'').trim())))
      return strings.launch;
    if(calls.some(call=>call.action?.startsWith('media_')) && !media.action && !mediaClue)
      return 'Aucune commande de lecture, pause ou changement de piste n’a été reconnue. Reformulez la demande ou mémorisez votre formulation.';
  }
  const simpleMedia = !knownDeezer && !knownMedia && !approved && !/\b(?:et|puis|mais|and|then|but)\b/u.test(normalized) && /^\s*(?:play|pause|joue|reprends(?:\s+la\s+lecture)?|mets\s+en\s+pause|mettre\s+en\s+pause|stop|arrete|piste\s+suivante|piste\s+precedente)\s+(?:(?:sur|dans|de|in|on)\s+)?([\p{L}\p{N} _-]+)[.!?]*\s*$/u.exec(normalized);
  if (simpleMedia) {
    if (!selectedApplicationId && !mentioned.length) return 'Le lecteur demandé n’est pas identifié. Précisez le nom ou un alias d’une application configurée.';
    const targets = config.applications.filter(app => app.enabled && labels(app).includes(simpleMedia[1].trim().replace(/\s+/g, ' ')));
    if (!selectedApplicationId && targets.length > 1) return 'Ce nom désigne plusieurs applications. Précisez le nom du lecteur souhaité.';
    if (calls.some(call => !call.action || call.action === 'open'))
      return 'La demande concerne la lecture d’un média. Aucune commande compatible n’a été reconnue pour ce lecteur.';
  }
  return null;
}
module.exports = {modelLabel, needleToolName, needleTools, canonicalPrompt, requestIssue};
