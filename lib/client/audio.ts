"use client";

/** Synthesised futuristic UI sounds — no audio assets, negligible CPU. */
type Cue =
  | "startup"
  | "accept"
  | "notify"
  | "warning"
  | "error"
  | "response"
  | "complete"
  | "click";

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(
  freq: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
  delay = 0,
  sweepTo?: number,
) {
  const ac = context();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const t0 = ac.currentTime + delay;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + duration);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export function playCue(cue: Cue, masterVolume = 0.3, enabled = true) {
  if (!enabled || masterVolume <= 0) return;
  const v = Math.min(0.5, masterVolume);
  switch (cue) {
    case "startup":
      tone(180, 0.5, v * 0.5, "sine", 0, 640);
      tone(420, 0.6, v * 0.35, "triangle", 0.12, 880);
      tone(880, 0.35, v * 0.22, "sine", 0.34);
      break;
    case "accept":
      tone(880, 0.09, v * 0.32, "square");
      tone(1320, 0.1, v * 0.22, "sine", 0.06);
      break;
    case "click":
      tone(620, 0.045, v * 0.18, "square");
      break;
    case "notify":
      tone(740, 0.12, v * 0.28, "sine");
      tone(1108, 0.12, v * 0.2, "sine", 0.09);
      break;
    case "response":
      tone(520, 0.14, v * 0.24, "triangle", 0, 760);
      break;
    case "complete":
      tone(660, 0.1, v * 0.26, "sine");
      tone(990, 0.14, v * 0.22, "sine", 0.08);
      tone(1320, 0.18, v * 0.16, "sine", 0.16);
      break;
    case "warning":
      tone(300, 0.18, v * 0.34, "sawtooth");
      tone(300, 0.18, v * 0.34, "sawtooth", 0.24);
      break;
    case "error":
      tone(200, 0.3, v * 0.38, "sawtooth", 0, 110);
      break;
  }
}

/** Live microphone amplitude meter (real Web Audio analysis). */
export class MicMeter {
  private stream: MediaStream | null = null;
  private ac: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private raf = 0;
  private data: Uint8Array<ArrayBuffer> | null = null;

  async start(onLevel: (level: number, spectrum: Uint8Array) => void) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.ac = new Ctor();
    const src = this.ac.createMediaStreamSource(this.stream);
    this.analyser = this.ac.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.72;
    src.connect(this.analyser);
    this.data = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

    const loop = () => {
      if (!this.analyser || !this.data) return;
      this.analyser.getByteFrequencyData(this.data);
      let sum = 0;
      for (let i = 0; i < this.data.length; i++) sum += this.data[i];
      onLevel(Math.min(1, sum / this.data.length / 110), this.data);
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ac?.close().catch(() => null);
    this.stream = null;
    this.ac = null;
    this.analyser = null;
  }
}
