const { createHash } = require('node:crypto');

// Model-facing names are independent of persisted action names and approvals.
function modelLabel(application) {
  return application.name.replace(/^(?:navigateur|browser)\s+/i, '').normalize('NFKD')
    .replace(/\p{M}/gu, '').trim() || 'application';
}
function needleToolName(tool, config) {
  // Keep the established Deezer schemas: their ID/query grounding was verified
  // with these names and descriptions. This optimization concerns app/media verbs.
  if (tool.action.startsWith('deezer_')) return tool.name;
  const application = config.applications.find(app => app.id === tool.applicationId);
  const slug = app => modelLabel(app).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'application';
  const target = slug(application);
  const duplicate = config.applications.some(app => app.enabled && app.id !== application.id && slug(app) === target);
  const suffix = duplicate ? `_${createHash('sha256').update(application.id).digest('hex').slice(0, 8)}` : '';
  return `${tool.action.replace(/^media_/, '')}_${target}${suffix}`;
}
function needleTools(tools, config) {
  return tools.map(tool => {
    if (tool.action.startsWith('deezer_')) {
      const {name, description, triggers, parameters} = tool;
      return {name, description, triggers, parameters};
    }
    const application = config.applications.find(app => app.id === tool.applicationId);
    const label = modelLabel(application);
    const descriptions = {
      open: `Open ${label}. ${application.description}`,
      media_play: `Play or resume audio or video in the ${label} browser.`,
      media_pause: `Pause audio or video in the ${label} browser.`,
      media_next: `Play the next item already in the ${label} queue.`,
      media_previous: `Play the previous item in ${label}.`,
      media_stop: `Stop audio or video playback in ${label}.`,
      media_toggle: `Toggle audio or video playback between play and pause in ${label}.`,
    };
    // A browser label is useful for Opera; other media applications are players.
    let description = descriptions[tool.action] ?? tool.description;
    if (!/navigateur|browser|opera|chrome|firefox|edge/i.test(application.name)) description = description.replace(' browser.', ' player.');
    return {name: needleToolName(tool, config), description: `${description} Aliases: ${[application.name, ...application.aliases].join(', ')}.`,
      triggers: tool.triggers, parameters: tool.parameters};
  });
}
function canonicalPrompt(tool, application) {
  const label = modelLabel(application);
  return ({open: `Open ${label}`, media_play: `Play audio in ${label}`, media_pause: `Pause audio in ${label}`,
    media_next: `Play the next item in ${label}`, media_previous: `Play the previous item in ${label}`,
    media_stop: `Stop playback in ${label}`, media_toggle: `Toggle playback in ${label}`})[tool.action];
}
function labels(application) {
  return [...new Set([application.name, ...application.aliases].map(label => label.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ')))];
}
function requestIssue(text, config, calls, selectedApplicationId) {
  const normalized = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’]/g, "'");
  // Refuse a leading negation, including one in a compound command clause.
  // Quoted text and explicit input values are data, not command clauses.
  let commandText = normalized.replace(/«[^»]*»|"[^"]*"|“[^”]*”/gu, ' ');
  const transmission = /\b(?:avec\s+(?:le\s+)?texte|with\s+(?:the\s+)?text)\b/u.exec(normalized);
  if (transmission && calls.some(call => typeof call.arguments?.input === 'string' && call.arguments.input.trim()))
    commandText = normalized.slice(0, transmission.index);
  if (/(?:^\s*|\b(?:et|puis|mais|and|then|but)\s+)(?:(?:surtout|merci de)\s+)?(?:ne\s+|n'|don't\s+|do not\s+|never\s+|(?:joue|ouvre|lance|reprends|mets|arrete)\s+pas\b)/u.test(commandText))
    return 'La demande contient une négation. Aucune action ne sera proposée ; formulez séparément l’action souhaitée.';
  if (/^\s*(?:(?:elle|il|on)\s+(?:a dit|dit|a demande|a ecrit)|(?:she|he|they)\s+(?:said|says|asked|wrote))\b/u.test(normalized) || /^\s*[«"“]/u.test(normalized))
    return 'Cette demande rapporte ou cite une commande. Reformulez directement l’action souhaitée.';
  const mentioned = config.applications.filter(app => labels(app).some(label => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped.replace(/ /g, '\\s+')}(?:$|[^\\p{L}\\p{N}])`, 'u').test(normalized);
  }));
  if (!selectedApplicationId && mentioned.length && calls.some(call => !mentioned.some(app => app.id === call.applicationId)))
    return 'L’application proposée ne correspond pas à celle nommée dans votre demande. Précisez son nom ou son alias.';
  const simpleMedia = !/\b(?:et|puis|mais|and|then|but)\b/u.test(normalized) && /^\s*(?:play|pause|joue|reprends(?:\s+la\s+lecture)?|mets\s+en\s+pause|mettre\s+en\s+pause|stop|arrete|piste\s+suivante|piste\s+precedente)\s+(?:(?:sur|dans|de|in|on)\s+)?([\p{L}\p{N} _-]+)[.!?]*\s*$/u.exec(normalized);
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
