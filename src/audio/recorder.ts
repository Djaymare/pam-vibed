import { encodeWav } from './wav';

export interface CaptureOptions {
  deviceId?: string;
  collect?: boolean;
  onInterrupted?: (error: Error) => void;
}

/** One acquisition owns its resources, including permission granted after disposal. */
export class VoiceRecorder {
  private stream?: MediaStream;
  private context?: AudioContext;
  private capture?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private chunks: Float32Array[] = [];
  private cleanups: (() => void)[] = [];
  private cancelled = false;
  private released = false;
  private starting = false;
  private ready = false;
  private releasePromise?: Promise<void>;
  private finishPromise?: Promise<Uint8Array>;
  private stopWait?: { resolve: () => void; reject: (error: Error) => void; timer: number };
  private options: CaptureOptions = {};

  private aborted() {
    return new Error('Capture annulée. Vous pouvez recommencer.');
  }
  private interrupted(message: string) {
    if (this.cancelled || this.released) return;
    const error = new Error(message);
    // Stop hardware synchronously before awaiting close() or notifying consumers.
    void this.dispose();
    this.options.onInterrupted?.(error);
  }
  private listen(target: EventTarget, event: string, handler: EventListener) {
    target.addEventListener(event, handler);
    this.cleanups.push(() => target.removeEventListener(event, handler));
  }
  async start(
    onLevel: (level: number) => void,
    onLimit: () => void,
    options: CaptureOptions = {},
  ): Promise<boolean> {
    if (this.starting || this.released) throw this.aborted();
    this.starting = true;
    this.options = options;
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia)
      throw new Error(
        'Le microphone n’est pas accessible dans cette fenêtre. Ouvrez PAM sous Windows puis réessayez.',
      );
    try {
      const stream = await media.getUserMedia({
        audio: {
          ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (this.cancelled || this.released) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.stream = stream;
      for (const track of stream.getAudioTracks()) {
        this.listen(track, 'ended', () =>
          this.interrupted(
            'Le microphone a été débranché ou son autorisation a été retirée. Rebranchez-le ou choisissez une autre entrée, puis testez le microphone.',
          ),
        );
        this.listen(track, 'mute', () =>
          this.interrupted(
            'Le microphone n’envoie plus de son. Vérifiez son branchement et ses permissions, puis testez-le avant de recommencer.',
          ),
        );
        if (track.readyState === 'ended')
          throw new Error(
            'Le microphone s’est arrêté. Rebranchez-le puis testez-le avant de recommencer.',
          );
      }
      this.listen(media, 'devicechange', () => {
        const deviceId = stream.getAudioTracks()[0]?.getSettings().deviceId;
        if (!deviceId || !media.enumerateDevices) return;
        void media
          .enumerateDevices()
          .then((devices) => {
            if (
              !devices.some(
                (device) => device.kind === 'audioinput' && device.deviceId === deviceId,
              )
            )
              this.interrupted(
                'Le microphone utilisé n’est plus disponible. Rebranchez-le ou choisissez une autre entrée, puis testez-le.',
              );
          })
          .catch(() =>
            this.interrupted(
              'Impossible de vérifier le microphone. Actualisez les entrées et testez-le avant de recommencer.',
            ),
          );
      });
      // Support varies by WebView2. Track/device events remain active if unsupported.
      if (navigator.permissions?.query) {
        void navigator.permissions
          .query({ name: 'microphone' as PermissionName })
          .then((permission) => {
            if (this.cancelled || this.released) return;
            const check = () => {
              if (permission.state === 'denied')
                this.interrupted(
                  'L’accès au microphone a été retiré. Autorisez-le dans les permissions de PAM, puis testez-le.',
                );
            };
            this.listen(permission, 'change', check);
            check();
          })
          .catch(() => {});
      }
      this.context = new AudioContext();
      const context = this.context;
      this.listen(context, 'statechange', () => {
        if (this.ready && context.state !== 'running')
          this.interrupted(
            'L’écoute a été interrompue (veille ou audio suspendu). Vérifiez le microphone puis relancez son test ; aucune capture ne reprend automatiquement.',
          );
      });
      await context.audioWorklet.addModule('/pcm-worklet.js');
      if (this.cancelled || this.released) return false;
      this.capture = new AudioWorkletNode(context, 'pcm-capture');
      this.capture.port.onmessage = (event) => {
        if (this.cancelled || this.released) return;
        if (event.data.type === 'samples') {
          const chunk: Float32Array = event.data.chunk;
          if (options.collect !== false) this.chunks.push(chunk);
          const rms = Math.sqrt(
            chunk.reduce((sum, value) => sum + value * value, 0) / chunk.length,
          );
          onLevel(Math.min(1, rms * 8));
        } else if (event.data.type === 'stopped') this.stopWait?.resolve();
        else if (event.data.type === 'limit') onLimit();
      };
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(this.capture);
      this.capture.connect(context.destination);
      await context.resume();
      if (this.cancelled || this.released) return false;
      if (context.state !== 'running')
        throw new Error(
          'L’audio reste suspendu. Cliquez de nouveau sur Tester le microphone pour reprendre après la veille.',
        );
      this.ready = true;
      return true;
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  finish(): Promise<Uint8Array> {
    return (this.finishPromise ??= this.finishOnce());
  }
  private async finishOnce(): Promise<Uint8Array> {
    const context = this.context,
      capture = this.capture;
    if (!this.ready || !context || !capture || this.cancelled || this.released)
      throw this.aborted();
    try {
      await new Promise<void>((resolve, reject) => {
        const settle = (error?: Error) => {
          window.clearTimeout(this.stopWait?.timer);
          this.stopWait = undefined;
          if (error) reject(error);
          else resolve();
        };
        this.stopWait = {
          resolve: () => settle(),
          reject: (error) => settle(error),
          timer: window.setTimeout(
            () => settle(new Error('Le microphone ne répond plus. Testez-le puis recommencez.')),
            2000,
          ),
        };
        capture.port.postMessage('stop');
      });
      const chunks = this.chunks,
        sampleRate = context.sampleRate;
      this.chunks = [];
      // Hardware is released before resampling or dispatching a request.
      await this.release();
      if (this.cancelled) throw this.aborted();
      const length = Math.min(
        Math.floor(sampleRate * 30),
        chunks.reduce((sum, chunk) => sum + chunk.length, 0),
      );
      if (length < sampleRate * 0.25)
        throw new Error('Parlez au moins un quart de seconde avant d’arrêter.');
      const samples = new Float32Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        const available = Math.min(chunk.length, length - offset);
        samples.set(chunk.subarray(0, available), offset);
        offset += available;
        if (offset >= length) break;
      }
      const offline = new OfflineAudioContext(
        1,
        Math.min(480_000, Math.floor((length * 16_000) / sampleRate)),
        16_000,
      );
      const buffer = offline.createBuffer(1, length, sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      if (this.cancelled) throw this.aborted();
      return encodeWav(rendered.getChannelData(0));
    } finally {
      await this.release();
    }
  }
  private release(): Promise<void> {
    if (this.releasePromise) return this.releasePromise;
    this.released = true;
    this.ready = false;
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    if (this.capture) this.capture.port.onmessage = null;
    for (const node of [this.source, this.capture]) {
      try {
        node?.disconnect();
      } catch {
        /* Already disconnected. */
      }
    }
    this.source = undefined;
    this.capture = undefined;
    const context = this.context;
    this.context = undefined;
    this.chunks = [];
    this.releasePromise = (async () => {
      if (context && context.state !== 'closed') await context.close();
    })().catch(() => {});
    return this.releasePromise;
  }
  dispose(): Promise<void> {
    this.cancelled = true;
    this.stopWait?.reject(this.aborted());
    return this.release();
  }
}
