import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { harness, settle } from './fixtures/vue-harness.mjs';
const require = createRequire(import.meta.url);
const { languages, strings } = require('../sidecar/languages.cjs');
const nodes = (n) => [n, ...n.children.flatMap(nodes)];
const text = (n) => n.text + n.children.map(text).join('');
test('language selector exposes scope before selection, in labels and accessible help', async (t) => {
  const h = harness(t);
  const { root } = h.mount((feature, vue) => {
    const profile = vue.reactive({
      config: { applications: [] },
      diagnostics: { pending: false },
      settingsDraft: { language: 'fr', autoExecute: false, confidenceThreshold: 0.7 },
      saveSettings() {},
    });
    const View = feature('views/SettingsView.vue').default;
    return () => vue.h(View, { profile, locked: false, shortcut: {} });
  });
  await settle();
  assert.deepEqual(h.errors, []);
  const all = nodes(root),
    select = all.find((n) => n.props.id === 'settings-language');
  assert.ok(select);
  assert.deepEqual(
    select.children.filter((n) => n.type === 'option').map((n) => n.props.value),
    languages.map((l) => l.id),
  );
  for (const language of languages) assert.ok(text(select).includes(language.option));
  const help = all.find((n) => n.props.id === 'settings-language-help');
  assert.ok(text(help).includes(strings.help));
  assert.ok(text(help).includes(strings.manualCorrection));
  assert.ok(select.props['aria-describedby'].includes(help.props.id));
  assert.ok(all.indexOf(help) < all.indexOf(select), 'limits are visible before the field');
  assert.deepEqual(h.errors, []);
});
test('browser, sidecar and package use the same language catalogue', () => {
  const ui = readFileSync('src/languages.ts', 'utf8');
  assert.ok(ui.includes('../sidecar/languages.json'));
  const bundle = JSON.parse(readFileSync('src-tauri/tauri.conf.json')).bundle.resources;
  for (const name of ['languages.cjs', 'languages.json']) {
    assert.equal(bundle['../sidecar/' + name], 'sidecar/' + name);
    assert.ok(readFileSync('scripts/verify-bundle.mjs', 'utf8').includes('sidecar/' + name));
  }
});
