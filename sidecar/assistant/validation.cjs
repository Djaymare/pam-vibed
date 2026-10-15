function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
function cleanText(value, label, max = 200) {
  ensure(
    typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= max &&
      !value.includes('\0'),
    `${label} invalide.`,
  );
  return value.trim();
}
module.exports = { ensure, cleanText };
