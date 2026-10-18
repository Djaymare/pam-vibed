// All application modules and native dependencies come from the published package.
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync, readFileSync } = require('node:fs');
const bundle = process.argv[2],
  profile = process.argv[3];
const { createAssistant } = require(join(bundle, 'sidecar/assistant.cjs'));
const { createEngine } = require(join(bundle, 'sidecar/engine.cjs'));
const engine = createEngine(join(bundle, 'runtime'));
(async () => {
  try {
    assert.equal(process.env.PATH, '');
    const handle = createAssistant({
      configDirectory: profile,
      runtimeDirectory: join(bundle, 'runtime'),
      engine,
      runEngine: engine.runEngine,
    });
    assert.equal((await handle('status')).engine.loaded, true);
    const marker = join(profile, 'marker'),
      fixture = join(profile, 'fixture.cjs');
    writeFileSync(fixture, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ok')`);
    await handle('save_application', {
      name: 'Test portable',
      aliases: [],
      description: 'Application de test',
      executable: join(bundle, 'pam-node.exe'),
      arguments: [fixture],
      enabled: true,
    });
    await handle('settings', { language: 'fr', autoExecute: false, confidenceThreshold: 0.7 });
    const turn = await handle('process_text', { text: 'Ouvre Test portable' });
    assert.equal(turn.status, 'pending');
    await handle('confirm', { id: turn.id });
    for (let n = 0; n < 40; n++) {
      try {
        assert.equal(readFileSync(marker, 'utf8'), 'ok');
        break;
      } catch (e) {
        if (n === 39) throw e;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    const wav = Buffer.alloc(44 + 32_000);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16_000, 24);
    wav.writeUInt32LE(32_000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(32_000, 40);
    assert.equal((await handle('process_audio', { audio: [...wav] })).status, 'silence');
    console.log(
      'Paquet isolé : moteur Needle, confirmation, exécutable jetable et silence Whistle : OK',
    );
  } finally {
    await engine.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
