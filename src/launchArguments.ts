/** JSON is the lossless interchange format; no quoting or shell parsing is applied. */
export function parseLaunchArguments(text: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Les arguments doivent être un tableau JSON de textes.');
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new Error('Les arguments doivent être un tableau JSON de textes.');
  return value;
}

export function previewArguments(args: string[], input: string): string[] {
  return args.map((argument) => argument.split('{input}').join(input));
}
