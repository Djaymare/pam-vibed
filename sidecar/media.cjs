const { nativeRequest } = require('./native.cjs');
const { DEEZER_APP_ID, deezerUri } = require('./deezer.cjs');
const { MEDIA_ACTIONS } = require('./action-registry.cjs');
function resolveSession(sessions, sourceAppId) {
  if (!Array.isArray(sessions)) throw new Error('Réponse des sessions Windows invalide.');
  const matching = sessions.filter(s => s.sourceAppId?.toLowerCase() === sourceAppId.toLowerCase());
  if (!matching.length) throw new Error('Aucune session compatible pour ce lecteur. Ouvrez un média dans ce lecteur puis actualisez les sessions.');
  if (matching.length !== 1) throw new Error('Plusieurs sessions de ce lecteur sont présentes. Fermez les médias supplémentaires pour choisir sans ambiguïté.');
  if (matching[0].error) throw new Error(`Session fermée ou indisponible : ${matching[0].error}`);
  return matching[0];
}
function createMedia(native = nativeRequest) {
  return {
    sessions: options => native({method:'media_sessions'}, options),
    async execute(application, action, args, options = {}) {
      const { budget, beforeEffect } = options;
      if (action.startsWith('media_')) {
        const command = action.slice(6);
        if (!Object.hasOwn(MEDIA_ACTIONS,command) || !application.media?.sourceAppId) throw new Error('Action ou lecteur multimédia non configuré.');
        const session = resolveSession(await native({method:'media_sessions'}, {budget}),application.media.sourceAppId);
        if (session.capabilities?.[command] !== true) throw new Error(`${application.name} ne prend actuellement pas en charge « ${MEDIA_ACTIONS[command]} ».`);
        budget?.check('commande média');
        await beforeEffect?.();
        budget?.check('commande média');
        const response = await native({method:'media_action',sourceAppId:application.media.sourceAppId,action:command}, {budget,effect:true});
        if (response?.accepted !== true) throw new Error(`${application.name} a refusé la commande multimédia.`);
        return {applicationName:application.name,success:true,message:`${MEDIA_ACTIONS[command]} : commande acceptée par ${application.name}.`,details:response};
      }
      if (application.media?.deezer !== true || application.windowsApp?.appId !== DEEZER_APP_ID) throw new Error('Le plugin nécessite l’application Deezer Music du Microsoft Store.');
      const uri = deezerUri(action,args);
      await beforeEffect?.();
      budget?.check('lien Deezer');
      const response = await native({method:'deezer_open',uri}, {budget,effect:true});
      if (response?.accepted !== true) throw new Error('Windows a refusé le lien destiné à Deezer Music. Vérifiez son installation.');
      return {applicationName:application.name,success:true,
        message:action === 'deezer_start' || (action === 'deezer_smarttracklist' && args.mode === 'play') ? 'Lecture de la sélection demandée à Deezer Music. Le protocole ne fournit pas de confirmation de lecture ; consultez la session Windows.' :
        action === 'deezer_reload' ? 'Rechargement demandé à Deezer Music.' : 'Lien envoyé à Deezer Music pour afficher le contenu. La lecture et la file ne sont pas modifiées par PAM.',details:response};
    },
  };
}
module.exports = { createMedia, MEDIA_ACTIONS, resolveSession };
