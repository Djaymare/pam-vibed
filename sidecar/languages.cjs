const { languages, strings } = require('./languages.json');
const LANGUAGES = new Set(languages.map((language) => language.id));
const executable = (id) => languages.some((language) => language.id === id && language.execution);
// The model's inference locale cannot grant permission to execute. Only the
// selected language, or Whistle's explicit detection in auto mode, can do so.
function languageIssue(selected, detected, method) {
  if (selected === 'auto')
    return method === 'process_audio' && executable(detected) ? null : strings.unknownDetection;
  if (method === 'process_audio' && detected && !executable(detected))
    return strings.transcriptionOnly;
  return executable(selected) ? null : strings.transcriptionOnly;
}
module.exports = { languages, strings, LANGUAGES, executable, languageIssue };
