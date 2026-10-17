import catalog from '../sidecar/languages.json';
export const languages = catalog.languages;
export const languageStrings = catalog.strings;
export const languageLabel = (id: string) =>
  languages.find((language) => language.id === id)?.label || languageStrings.unknown;
