// Exercise the recording UI without accessing an audio device or personal data.
export class VoiceRecorder {
  async start(onLevel) {
    if(window.pamFixture.getState()==='mic-denied') throw new DOMException('Fixture','NotAllowedError');
    if(window.pamFixture.getState()==='mic-wait') await new Promise(resolve=>{window.releaseFixture=resolve;});
    onLevel(0.5);
  }
  async finish() {return new Uint8Array();}
  async dispose() {}
}
