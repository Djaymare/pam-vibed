import { encodeWav } from './wav';

export class VoiceRecorder {
  private stream?: MediaStream;
  private context?: AudioContext;
  private capture?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private chunks: Float32Array[] = [];
  private stopped?: () => void;
  private cancelled = false;

  async start(onLevel: (level: number) => void, onLimit: () => void) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Le microphone n’est pas accessible dans cette fenêtre.');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
      if (this.cancelled) { this.stream.getTracks().forEach(track => track.stop()); return; }
      this.context = new AudioContext();
      await this.context.audioWorklet.addModule('/pcm-worklet.js');
      if (this.cancelled) { await this.dispose(); return; }
      this.capture = new AudioWorkletNode(this.context, 'pcm-capture');
      this.capture.port.onmessage = event => {
        if (event.data.type === 'samples') {
          const chunk: Float32Array = event.data.chunk; this.chunks.push(chunk);
          const rms = Math.sqrt(chunk.reduce((sum, value) => sum + value * value, 0) / chunk.length);
          onLevel(Math.min(1, rms * 8));
        } else if (event.data.type === 'stopped') this.stopped?.();
        else if (event.data.type === 'limit') onLimit();
      };
      this.source = this.context.createMediaStreamSource(this.stream);
      this.source.connect(this.capture); this.capture.connect(this.context.destination);
      await this.context.resume();
    } catch (error) { await this.dispose(); throw error; }
  }
  async finish(): Promise<Uint8Array> {
    const context = this.context; const capture = this.capture;
    if (!context || !capture) throw new Error('L’enregistrement n’a pas démarré.');
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Le microphone ne répond plus.')), 2000);
        this.stopped = () => { window.clearTimeout(timeout); resolve(); };
        capture.port.postMessage('stop');
      });
      const length = Math.min(Math.floor(context.sampleRate * 30), this.chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      if (length < context.sampleRate * 0.25) throw new Error('Parlez au moins un quart de seconde avant d’arrêter.');
      const samples = new Float32Array(length); let offset = 0;
      for (const chunk of this.chunks) {
        const available = Math.min(chunk.length, length - offset);
        samples.set(chunk.subarray(0, available), offset); offset += available;
        if (offset >= length) break;
      }
      // Filtered resampling for 44.1/48 kHz microphones, bounded to 30 seconds.
      const offline = new OfflineAudioContext(1, Math.min(480_000, Math.floor(length * 16_000 / context.sampleRate)), 16_000);
      const buffer = offline.createBuffer(1, length, context.sampleRate); buffer.copyToChannel(samples, 0);
      const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start();
      const rendered = await offline.startRendering(); return encodeWav(rendered.getChannelData(0));
    } finally { await this.dispose(); }
  }
  async dispose() {
    this.cancelled = true; this.stream?.getTracks().forEach(track => track.stop());
    this.source?.disconnect(); this.capture?.disconnect();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.chunks = [];
  }
}
