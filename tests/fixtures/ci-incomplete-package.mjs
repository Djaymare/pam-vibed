// Disposable negative CI probe; never integrated.
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {resolvePortable} from '../../scripts/portable-integrity.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
const bundle=await resolvePortable(join(root,'artifacts/PAM-windows-x64'));
await unlink(join(bundle,'sidecar/contracts.cjs'));
console.log('PAM-33 controlled missing package resource');
