import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { encodeWav } from '../../src/audio/wav.ts';
import { deferred } from './vue-harness.mjs';

export class Target {
  listeners = new Map();
  addEventListener(name, callback) { const group = this.listeners.get(name) || new Set(); group.add(callback); this.listeners.set(name, group); }
  removeEventListener(name, callback) { const group = this.listeners.get(name); group?.delete(callback); if (!group?.size) this.listeners.delete(name); }
  fire(name) { for (const callback of [...(this.listeners.get(name) || [])]) callback({ type: name }); }
}
export function recorderHarness(options = {}) {
  const calls = [], timers = new Map(), contexts = [], worklets = [], offlines = [];
  const track = new Target(); track.readyState = 'live'; track.stops = 0;
  track.stop = () => { track.stops++; track.readyState = 'ended'; };
  track.getSettings = () => ({ deviceId: 'usb-mic' });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const media = new Target();
  media.getUserMedia = async constraints => { calls.push(constraints); return options.permission ? options.permission.promise : stream; };
  media.enumerateDevices = async () => options.devices ?? [{ kind: 'audioinput', deviceId: 'usb-mic' }];
  const permission = new Target(); permission.state = 'granted';
  const node = () => ({ disconnects: 0, connect() {}, disconnect() { this.disconnects++; } });
  class Context extends Target {
    state = 'suspended'; sampleRate = 48_000; destination = {}; closes = 0;
    constructor() { super(); contexts.push(this); this.audioWorklet = { addModule: async () => { if (options.module) await options.module.promise; } }; }
    createMediaStreamSource() { return this.source = node(); }
    async resume() { if (options.resume) await options.resume.promise; if (this.state !== 'closed') this.state = options.suspended ? 'suspended' : 'running'; }
    async close() { this.closes++; this.state = 'closed'; if (options.close) await options.close.promise; }
  }
  class Worklet {
    constructor() { Object.assign(this, node()); this.port = { onmessage: null, postMessage: message => { this.stopMessages = (this.stopMessages || 0) + 1; if (options.ack !== false && message === 'stop') queueMicrotask(() => this.port.onmessage?.({ data: { type: 'stopped' } })); } }; worklets.push(this); }
  }
  class Offline {
    destination = {};
    constructor(channels, length, sampleRate) { Object.assign(this, { channels, length, sampleRate }); offlines.push(this); }
    createBuffer() { return { copyToChannel() {} }; }
    createBufferSource() { return { connect() {}, start() {} }; }
    async startRendering() { if (options.render) await options.render.promise; return { getChannelData: () => new Float32Array(this.length) }; }
  }
  let timer = 0;
  const window = { setTimeout: (fn, ms) => { const id = ++timer; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) };
  const out = {}, code = ts.transpileModule(readFileSync(new URL('../../src/audio/recorder.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: out, require: () => ({ encodeWav }), navigator: { mediaDevices: media, permissions: { query: () => options.permissionQuery?.promise ?? Promise.resolve(permission) } }, window, AudioContext: Context, AudioWorkletNode: Worklet, OfflineAudioContext: Offline, Float32Array, Uint8Array, Error });
  const recorder = new out.VoiceRecorder();
  const samples = (length = 24_000) => worklets[0].port.onmessage?.({ data: { type: 'samples', chunk: new Float32Array(length).fill(0.1) } });
  return { recorder, media, track, stream, permission, calls, contexts, worklets, offlines, samples, timers, deferred };
}
