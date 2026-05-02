export class AudioManager {
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;

  init(): void {
    this.ctx = new AudioContext();
  }

  startEngine(): void {
    if (!this.ctx) return;
    this.engineOsc = this.ctx.createOscillator();
    this.engineGain = this.ctx.createGain();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 80;
    this.engineGain.gain.value = 0.05;
    this.engineOsc.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);
    this.engineOsc.start();
  }

  updateEngineSpeed(speedKmh: number): void {
    if (!this.engineOsc || !this.engineGain || !this.ctx) return;
    const freq = 80 + (speedKmh / 200) * 200;
    this.engineOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.1);
    this.engineGain.gain.setTargetAtTime(0.03 + (speedKmh / 200) * 0.05, this.ctx.currentTime, 0.1);
  }

  stopEngine(): void {
    this.engineOsc?.stop();
    this.engineOsc = null;
  }

  playDrift(): void { this.playNoise(0.15, 800, 0.03); }
  playCollision(): void { this.playTone(100, 0.15, 'square', 0.1); }
  playPickup(): void {
    this.playTone(880, 0.1, 'sine', 0.08);
    setTimeout(() => this.playTone(1100, 0.1, 'sine', 0.08), 100);
  }
  playUseItem(): void { this.playTone(440, 0.15, 'sawtooth', 0.06); }
  playCountdown(): void { this.playTone(660, 0.2, 'square', 0.08); }
  playGo(): void { this.playTone(880, 0.3, 'square', 0.1); }

  private playTone(freq: number, duration: number, type: OscillatorType, volume: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  private playNoise(duration: number, filterFreq: number, volume: number): void {
    if (!this.ctx) return;
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    source.start();
  }
}
