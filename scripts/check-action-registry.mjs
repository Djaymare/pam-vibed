import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Read the literals actually used by the independent native validator. Rust tests
// separately execute that validator against the shared URI corpus and refusals.
export function checkNativeConcordance(registry, nativeSource) {
  const native = name => {
    const body = nativeSource.match(new RegExp(`const ${name}: &[\\s\\S]*?= &\\[([\\s\\S]*?)\\];`))?.[1];
    assert.ok(body !== undefined, `Native allowlist missing: ${name}`);
    return [...body.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map(m => JSON.parse(m[0]));
  };
  const same = (name, values) => assert.deepEqual(native(name).sort(), [...new Set(values)].sort(), `Action registry/native drift: ${name}`);
  same('NATIVE_PREFIXES', registry.deezer.protocols.map(p => `${p}://${registry.deezer.host}/`));
  same('NATIVE_PAGE_PATHS', [...registry.deezer.legacyPaths, ...registry.actions.filter(a => a.route?.kind === 'fixed').map(a => a.route.path),
    ...registry.actions.filter(a => a.route?.kind === 'option').flatMap(a => Object.values(registry.options[a.route.options]).map(o => o.path))]);
  same('NATIVE_CONTENT_KINDS', Object.keys(registry.options.contents));
  same('NATIVE_MEDIA_ACTIONS', registry.actions.filter(a => a.family === 'media').map(a => a.nativeAction));
}
export const nativeMediaSource = () => readFileSync(new URL('../src-tauri/src/media.rs',import.meta.url),'utf8');
