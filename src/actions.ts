import type { Application, CommandAction, CommandAlias } from './types';
import { actionRegistry } from './actions.generated';
export { actionRegistry };
export const actionDefinitions = Object.fromEntries(
  actionRegistry.actions.map((action) => [action.id, action]),
);
export const commandActionLabels = Object.fromEntries(
  actionRegistry.actions.map((action) => [action.id, action.label]),
) as Record<CommandAction, string>;
const optionLabels = (options: Record<string, { label: string }>) =>
  Object.fromEntries(Object.entries(options).map(([key, value]) => [key, value.label]));
export const deezerPages = optionLabels(actionRegistry.options.pages);
export const deezerContent = optionLabels(actionRegistry.options.contents);
export const deezerMixes = optionLabels(actionRegistry.options.mixes);
export const deezerModes = optionLabels(actionRegistry.options.modes);
export const mediaActions = actionRegistry.actions
  .filter((action) => action.family === 'media')
  .map((action) => ({
    action: action.id,
    capability: action.nativeAction,
    label: action.shortLabel,
  }));
export interface ActionParameter {
  default?: string;
  trim?: boolean;
  label?: string;
  help?: string;
  pattern?: string;
  maxLength?: number;
  inputmode?: 'text' | 'numeric';
  options?: keyof typeof actionRegistry.options;
}
export function actionParameters(action: CommandAction): Record<string, ActionParameter> {
  return actionDefinitions[action].parameters.properties;
}
export function correctionFields(action?: CommandAction) {
  if (!action) return [];
  const definition = actionDefinitions[action];
  if (definition.family !== 'deezer' || definition.route.kind === 'option') return [];
  return Object.entries(actionParameters(action)).map(([key, property]) => ({
    key,
    ...property,
    required: (definition.parameters.required as readonly string[]).includes(key),
    values: property.options ? optionLabels(actionRegistry.options[property.options]) : undefined,
  }));
}
export function validActionField(action: CommandAction, key: string, value: string): boolean {
  const property = actionParameters(action)[key];
  return (
    Boolean(value.trim()) &&
    (!property.pattern || new RegExp(property.pattern).test(value)) &&
    (!property.maxLength || value.length <= property.maxLength)
  );
}
export interface CommandChoice {
  key: string;
  action: CommandAction;
  label: string;
  arguments?: Record<string, string>;
}
export function commandActions(application?: Application): CommandChoice[] {
  if (!application) return [];
  const actions = actionRegistry.actions
    .filter(
      (action) =>
        action.family === 'application' || (action.family === 'media' && application.media),
    )
    .map((action) => action.id)
    .map(
      (action) => ({ key: action, action, label: commandActionLabels[action] }) as CommandChoice,
    );
  if (application.media?.deezer)
    for (const definition of actionRegistry.actions) {
      if (definition.family !== 'deezer') continue;
      if (definition.route.kind === 'option') {
        const route = definition.route;
        for (const [value, option] of Object.entries(actionRegistry.options[route.options])) {
          actions.push({
            key: 'choiceKey' in option ? option.choiceKey : `${definition.id}_${value}`,
            action: definition.id,
            label: ('choicePrefix' in definition ? definition.choicePrefix : '') + option.label,
            arguments: { [route.parameter]: value },
          });
        }
      } else actions.push({ key: definition.id, action: definition.id, label: definition.label });
    }
  return actions;
}
export function commandChoiceKey(alias: Pick<CommandAlias, 'action' | 'arguments'>): string {
  const definition = actionDefinitions[alias.action];
  if ('route' in definition && definition.route.kind === 'option') {
    const route = definition.route,
      value = alias.arguments?.[route.parameter];
    const options: Record<string, { label: string; choiceKey?: string }> =
      actionRegistry.options[route.options];
    return (value && options[value]?.choiceKey) || `${alias.action}_${value}`;
  }
  return alias.action;
}
export function choiceArguments(
  choice: CommandChoice,
  fields: Record<string, string>,
): Record<string, string> {
  if (choice.arguments) return { ...choice.arguments };
  const definition = actionDefinitions[choice.action];
  if (definition.family !== 'deezer') return {};
  return Object.fromEntries(
    Object.entries(definition.parameters.properties).map(([key, property]) => {
      const p = property as { default?: string; trim?: boolean };
      const value = fields[key] || p.default || '';
      return [key, p.trim ? value.trim() : value];
    }),
  );
}
export function commandLabel(alias: Pick<CommandAlias, 'action' | 'arguments'>): string {
  const args = alias.arguments || {};
  if (alias.action === 'deezer_start')
    return args.mix === 'flow' ? 'Démarrer Flow' : 'Lire les coups de cœur';
  if (alias.action === 'deezer_page')
    return `Afficher ${deezerPages[args.page as keyof typeof deezerPages] || 'une page'}`;
  if (alias.action === 'deezer_search') return `Rechercher « ${args.query} »`;
  if (alias.action === 'deezer_content')
    return `Afficher ${deezerContent[args.kind as keyof typeof deezerContent]} ${args.id}`;
  if (alias.action === 'deezer_smarttracklist')
    return `${args.mode === 'play' ? 'Lire' : 'Afficher'} la sélection ${args.id}`;
  return commandActionLabels[alias.action];
}
