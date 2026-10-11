const normalize=text=>text.normalize('NFKD').replace(/\p{M}/gu,'').replace(/’/g,"'").toLowerCase().trim().replace(/\s+/g,' ').replace(/[.!?]+$/u,'').trim();
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/ /g,'\\s+');
const ITEM='(?:piste|chanson|morceau|titre)s?';
const PREFIX='(?:(?:passe[r]?|va|aller)\\s+(?:(?:a|au)\\s+)?(?:(?:la|le|les|une?)\\s+)?)?';
const NEXT=new RegExp(`^${PREFIX}(?:${ITEM}\\s+(?:suivant|prochain)[e]?s?|(?:suivant|prochain)[e]?s?\\s+${ITEM})$`);
const PREVIOUS=new RegExp(`^${PREFIX}(?:${ITEM}\\s+precedent[e]?s?|precedent[e]?s?\\s+${ITEM})$`);
function parseMediaAction(text) {
  const command=normalize(text);
  if(NEXT.test(command) || /^(?:passe[r]?\s+(?:la|le)\s+(?:piste|chanson|morceau)|next|suivant[e]?)$/u.test(command))return 'media_next';
  if(PREVIOUS.test(command) || /^(?:previous|precedent[e]?)$/u.test(command))return 'media_previous';
  if(/^(?:mais\s+)?(?:pause|pose|pauser|pauiser)(?:\s+(?:le\s+|la\s+)?(?:media|musique|lecture|chanson|video|film))?$/u.test(command) ||
    /^(?:mets?|mettre|mais)\s+(?:en\s+(?:pause|pose)|empose)$/u.test(command) ||
    /^(?:(?:mets?|mettre|mais)\s+)?(?:(?:le|la|les)\s+)?(?:media|musique|lecture|chanson|video|film)\s+(?:en\s+(?:pause|pose)|empose)$/u.test(command))return 'media_pause';
  if(/^(?:lecture|play|joue[r]?|reprends?|reprendre)(?:\s+(?:la\s+)?lecture)?$/u.test(command))return 'media_play';
  if(/^(?:arrete[r]?|stop|stoppe[r]?)(?:\s+(?:(?:la|le)\s+)?(?:lecture|musique|video|chanson|media))?$/u.test(command))return 'media_stop';
  if(/^(?:bascule[r]?(?:\s+(?:la\s+)?lecture\s*[/ ]\s*pause)?|lecture\s*\/\s*pause)$/u.test(command))return 'media_toggle';
  return null;
}
function resolveMediaCommand(text,config,sessions,selectedApplicationId) {
  const command=normalize(text),matches=[];
  // A literal application name keeps its existing launch meaning, even if it
  // happens to be called Pause or Next. Personal command aliases take priority.
  if(config.applications.some(app=>[app.name,...app.aliases].some(name=>normalize(name)===command)))return {};
  for(const app of config.applications) {
    for(const name of new Set([app.name,...app.aliases].map(normalize))) {
      const patterns=[
        `^(.+?)\\s+(?:(?:dans|sur|de|au|a|in|on)\\s+)?${escape(name)}$`,
        `^(?:(?:dans|sur)\\s+)?${escape(name)}(?:\\s*[:,]\\s*|\\s+)(.+)$`,
      ];
      for(const pattern of patterns) {
        const match=new RegExp(pattern,'u').exec(command),action=match && parseMediaAction(match[1]);
        if(action)matches.push({applicationId:app.id,action});
      }
      if(new RegExp(`^(?:mets?|mettre|mais)\\s+${escape(name)}\\s+(?:en\\s+(?:pause|pose)|empose)$`,'u').test(command))
        matches.push({applicationId:app.id,action:'media_pause'});
    }
  }
  const enabled=matches.filter(match=>config.applications.some(app=>app.id===match.applicationId && app.enabled));
  const unique=[...new Map((enabled.length ? enabled : matches).map(match=>[JSON.stringify(match),match])).values()];
  const personalizable=/\b(?:pose|empose|pauiser|mais)\b/u.test(command);
  if(unique.length>1 && !selectedApplicationId)return {issue:'Ce nom désigne plusieurs applications. Précisez le nom ou un alias unique du lecteur souhaité.'};
  let action=unique[0]?.action || parseMediaAction(command);
  let applicationId=selectedApplicationId || unique[0]?.applicationId;
  const mentioned=config.applications.some(app=>[app.name,...app.aliases].some(name=>
    new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(normalize(name))}(?:$|[^\\p{L}\\p{N}])`,'u').test(command)));
  if(!action && !mentioned && !/\b(?:pas|et|puis|mais|and|then|but)\b/u.test(command.replace(/^mais\s+/u,'')) && !/^(?:ne\b|n'|elle\b|il\b|on\b|he\b|she\b|they\b|[«"“])/u.test(command)) {
    // A recognizable action next to an unknown name is not a launch request.
    const words=command.split(' ');
    for(let split=1;split<words.length && !action;split++)
      action=parseMediaAction(words.slice(0,split).join(' ')) || parseMediaAction(words.slice(split).join(' '));
    if(!action && /^(?:mets?|mettre|mais)\s+.+\s+(?:en\s+(?:pause|pose)|empose)$/u.test(command))action='media_pause';
    if(action && !selectedApplicationId)return {action,issue:'Le lecteur demandé n’est pas identifié. Précisez son nom ou mémorisez cette formulation avec « Corriger la demande ».'};
  }
  if(!action)return {};
  if(!applicationId && sessions!==undefined) {
    const active=config.applications.filter(app=>app.enabled && app.media?.sourceAppId &&
      sessions.some(session=>!session.error && session.sourceAppId?.toLowerCase()===app.media.sourceAppId.toLowerCase()));
    if(active.length!==1)return {action,issue:active.length ? 'Plusieurs lecteurs sont actifs. Précisez le nom du lecteur souhaité dans votre commande.' :
      'Aucun lecteur actif n’est disponible. Ouvrez un média dans un lecteur configuré puis actualisez les sessions.'};
    const matching=sessions.filter(session=>session.sourceAppId?.toLowerCase()===active[0].media.sourceAppId.toLowerCase());
    if(matching.length!==1 || matching[0].error)return {action,issue:'Plusieurs sessions ou une session indisponible empêchent de choisir ce lecteur. Vérifiez ses sessions Windows.'};
    applicationId=active[0].id;
  }
  if(applicationId) {
    const app=config.applications.find(app=>app.id===applicationId);
    if(!app?.enabled || !app.media?.sourceAppId)return {action,issue:'Le lecteur demandé ne propose pas de commandes multimédias actives. Vérifiez sa fiche dans Applications.'};
  }
  return {action,...(applicationId ? {applicationId} : {}),personalizable};
}
module.exports={parseMediaAction,resolveMediaCommand};
