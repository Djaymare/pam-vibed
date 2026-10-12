import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDevelopment, developmentBindings } from '../scripts/check-development.mjs';

function fixture(t, platform) {
  const root = mkdtempSync(join(tmpdir(), 'pam-development-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ engines: { node: '24.21.0', npm: '11.19.0' } }));
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(root, 'node_modules', '.bin', platform === 'win32' ? 'vue-tsc.cmd' : 'vue-tsc'), 'fixture');
  return root;
}

for (const platform of ['win32', 'linux']) {
  test(`les deux bindings ${platform} sont chargés avant le build`, t => {
    const root = fixture(t, platform);
    const loaded = [];
    const result = checkDevelopment(root, { platform, arch: 'x64', nodeVersion: '24.21.0', npmAgent: 'npm/11.19.0 node/v24.21.0', load: binding => loaded.push(binding) });
    assert.deepEqual(loaded, developmentBindings(platform, 'x64'));
    assert.equal(result.platform, platform);
  });
}

test('un node_modules Linux est refusé sous Windows sans être modifié', t => {
  const root = fixture(t, 'linux');
  assert.throws(() => checkDevelopment(root, { platform: 'win32', arch: 'x64', nodeVersion: '24.21.0', load: () => assert.fail('aucun binding ne doit être chargé') }), /Lanceur win32.*checkout propre/);
  assert.doesNotThrow(() => checkDevelopment(root, { platform: 'linux', arch: 'x64', nodeVersion: '24.21.0', load: () => {} }));
});

for (const missing of developmentBindings('win32', 'x64')) {
  test(`le binding absent ou incompatible ${missing} arrête le build`, t => {
    const root = fixture(t, 'win32');
    const failure = new Error('module natif incompatible');
    assert.throws(() => checkDevelopment(root, { platform: 'win32', arch: 'x64', nodeVersion: '24.21.0', load: binding => { if (binding === missing) throw failure; } }), error => error.message.includes(`Binding natif ${missing}`) && error.cause === failure);
  });
}

test('Node et npm différents des versions fixées sont refusés', t => {
  const root = fixture(t, 'win32');
  assert.throws(() => checkDevelopment(root, { nodeVersion: '22.0.0' }), /Node 24.21.0 requis/);
  assert.throws(() => checkDevelopment(root, { nodeVersion: '24.21.0', npmAgent: 'npm/10.0.0' }), /npm 11.19.0 requis/);
  assert.throws(() => developmentBindings('linux', 'arm64'), /x64/);
});
