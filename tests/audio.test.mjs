import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { encodeWav } from '../src/audio/wav.ts';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateWav } = require('../sidecar/assistant.cjs');

test('le WAV de capture est accepté par le bridge et sature correctement le PCM', () => {
  const bytes = encodeWav(new Float32Array([-2, -1, 0, 1, 2, NaN]));
  assert.equal(validateWav(Array.from(bytes)).length, 56);
  const view = new DataView(bytes.buffer);
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => view.getInt16(44 + index * 2, true)), [-32768, -32768, 0, 32767, 32767, 0]);
});

async function captureFixture() {
  const source = await readFile(new URL('../public/pcm-worklet.js', import.meta.url), 'utf8');
  const messages = [];
  let Processor;
  const context = vm.createContext({ sampleRate: 48000, Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
    registerProcessor: (name, value) => { assert.equal(name, 'pcm-capture'); Processor = value; },
  });
  vm.runInContext(source, context);
  return { capture: new Processor(), messages };
}

test('le Worklet mélange les canaux, conserve la fin du clip et produit une sortie muette', async () => {
  const { capture, messages } = await captureFixture();
  const left = new Float32Array(128).fill(0.8); const right = new Float32Array(128).fill(0.2);
  const output = new Float32Array(128).fill(1);
  capture.process([[left, right]], [[output]]);
  capture.port.onmessage({ data: 'stop' });
  assert.equal(messages[0].type, 'samples'); assert.equal(messages[0].chunk.length, 128);
  assert.ok(messages[0].chunk.every(sample => Math.abs(sample - 0.5) < 0.00001));
  assert.ok(output.every(sample => sample === 0)); assert.equal(messages[1].type, 'stopped');
  capture.process([[left]], [[output]]); assert.equal(messages.length, 2);
});

test('la capture 48 kHz reste bornée à 30 secondes même si le minuteur UI est retardé', async () => {
  const { capture, messages } = await captureFixture();
  const input = new Float32Array(128).fill(0.1);
  for (let frame = 0; frame < 12000; frame++) capture.process([[input]], [[new Float32Array(128)]]);
  const samples = messages.filter(message => message.type === 'samples').reduce((sum, message) => sum + message.chunk.length, 0);
  assert.equal(samples, 48_000 * 30); assert.equal(messages.filter(message => message.type === 'limit').length, 1);
});
