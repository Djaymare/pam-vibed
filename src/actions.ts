import type {Application, CommandAction, CommandAlias} from './types';
export const commandActionLabels: Record<CommandAction,string> = {
  open:'Ouvrir l’application',media_play:'Reprendre la lecture',media_pause:'Mettre en pause',media_next:'Piste suivante',
  media_previous:'Piste précédente',media_stop:'Arrêter la lecture',media_toggle:'Basculer lecture / pause',
  deezer_start:'Démarrer une sélection',deezer_page:'Afficher une page',deezer_search:'Rechercher dans Deezer',
  deezer_content:'Afficher un contenu Deezer',deezer_reload:'Recharger Deezer',deezer_smarttracklist:'Afficher ou lire une sélection Deezer',
};
export const deezerPages={home:'Accueil',podcasts:'Podcasts',explore:'Explorer',charts:'Classements',moods:'Ambiances',radios:'Radios',audio_settings:'Réglages audio',theme:'Apparence'};
export const deezerContent={track:'Chanson',album:'Album',artist:'Artiste',playlist:'Playlist',show:'Podcast',episode:'Épisode',profile:'Profil'};
export interface CommandChoice { key:string; action:CommandAction; label:string; arguments?:Record<string,string> }
export function commandActions(application?: Application): CommandChoice[] {
  if(!application)return [];
  const actions=(Object.keys(commandActionLabels) as CommandAction[]).filter(action=>action==='open' || action.startsWith('media_') && application.media)
    .map(action=>({key:action,action,label:commandActionLabels[action]} as CommandChoice));
  if(application.media?.deezer)actions.push(
    {key:'deezer_flow',action:'deezer_start',label:'Démarrer Flow',arguments:{mix:'flow'}},
    {key:'deezer_favorites',action:'deezer_start',label:'Lire les coups de cœur',arguments:{mix:'loved_tracks'}},
    {key:'deezer_search',action:'deezer_search',label:commandActionLabels.deezer_search},
    {key:'deezer_content',action:'deezer_content',label:commandActionLabels.deezer_content},
    ...Object.entries(deezerPages).map(([page,label])=>({key:`deezer_page_${page}`,action:'deezer_page' as const,label:`Afficher ${label}`,arguments:{page}})),
    {key:'deezer_smarttracklist',action:'deezer_smarttracklist',label:commandActionLabels.deezer_smarttracklist},
    {key:'deezer_reload',action:'deezer_reload',label:commandActionLabels.deezer_reload},
  );
  return actions;
}
export function commandChoiceKey(alias:Pick<CommandAlias,'action'|'arguments'>):string {
  if(alias.action==='deezer_start')return alias.arguments?.mix==='flow'?'deezer_flow':'deezer_favorites';
  if(alias.action==='deezer_page')return `deezer_page_${alias.arguments?.page}`;
  return alias.action;
}
export function choiceArguments(choice:CommandChoice,fields:Record<string,string>):Record<string,string> {
  if(choice.arguments)return {...choice.arguments};
  if(choice.action==='deezer_search')return {query:fields.query?.trim() || ''};
  if(choice.action==='deezer_content')return {kind:fields.kind || 'track',id:fields.id || ''};
  if(choice.action==='deezer_smarttracklist')return {id:fields.id || '',mode:fields.mode || 'display'};
  return {};
}
export function commandLabel(alias:Pick<CommandAlias,'action'|'arguments'>):string {
  const args=alias.arguments || {};
  if(alias.action==='deezer_start')return args.mix==='flow'?'Démarrer Flow':'Lire les coups de cœur';
  if(alias.action==='deezer_page')return `Afficher ${deezerPages[args.page as keyof typeof deezerPages] || 'une page'}`;
  if(alias.action==='deezer_search')return `Rechercher « ${args.query} »`;
  if(alias.action==='deezer_content')return `Afficher ${deezerContent[args.kind as keyof typeof deezerContent]} ${args.id}`;
  if(alias.action==='deezer_smarttracklist')return `${args.mode==='play'?'Lire':'Afficher'} la sélection ${args.id}`;
  return commandActionLabels[alias.action];
}
