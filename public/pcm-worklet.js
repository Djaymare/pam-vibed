class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.total = 0;
    this.limit = Math.floor(sampleRate * 30);
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.port.onmessage = event => {
      if (event.data === 'stop') {
        this.flush(); this.active = false; this.port.postMessage({ type: 'stopped' });
      }
    };
  }
  flush() {
    if (!this.offset) return;
    const chunk = this.buffer.slice(0, this.offset);
    this.port.postMessage({ type: 'samples', chunk }, [chunk.buffer]);
    this.offset = 0;
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    const channels = inputs[0];
    if (!this.active || !channels?.length) return true;
    for (let index = 0; index < channels[0].length && this.total < this.limit; index++) {
      let value = 0;
      for (const channel of channels) value += channel[index] || 0;
      this.buffer[this.offset++] = value / channels.length; this.total++;
      if (this.offset === this.buffer.length) this.flush();
    }
    if (this.total >= this.limit) { this.flush(); this.active = false; this.port.postMessage({ type: 'limit' }); }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
