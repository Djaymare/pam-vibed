import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishPortable } from './portable-integrity.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(process.argv[2] || join(root, 'artifacts/PAM-windows-x64'));
const bundle = await publishPortable(
  root,
  destination,
  join(root, 'artifacts/build/windows-x64.json'),
);
console.log(`Paquet publié : ${bundle}\nPointeur atomique : ${join(destination, 'current.json')}`);
