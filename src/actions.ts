import type {Application, CommandAction} from './types';
export const commandActionLabels: Record<CommandAction,string> = {
  open:'Ouvrir l’application',media_play:'Reprendre la lecture',media_pause:'Mettre en pause',media_next:'Piste suivante',
  media_previous:'Piste précédente',media_stop:'Arrêter la lecture',media_toggle:'Basculer lecture / pause',
};
export function commandActions(application?: Application): CommandAction[] {
  return application ? (Object.keys(commandActionLabels) as CommandAction[]).filter(action=>action==='open' || application.media) : [];
}
