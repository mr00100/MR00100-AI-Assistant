"use client";

/* Minimal typings for the Web Speech API (not in lib.dom for all targets). */
type SpeechRecognitionAlternative = { transcript: string; confidence: number };
type SpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  0: SpeechRecognitionAlternative;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResult };
};
export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type RecognitionCtor = new () => SpeechRecognitionLike;

export function speechLangFromSetting(setting?: string): string {
  if (setting === "ur") return "ur-PK";
  if (setting === "en" || setting === "roman" || setting === "auto") return "en-US";
  return "en-US";
}

export function getRecognition(lang?: string): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang || navigator.language || "en-US";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  return rec;
}

export function speechSupported() {
  if (typeof window === "undefined") return { stt: false, tts: false };
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return {
    stt: Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition),
    tts: typeof window.speechSynthesis !== "undefined",
  };
}

export type SpeakOptions = {
  rate?: number;
  pitch?: number;
  volume?: number;
  voiceName?: string;
  onStart?: () => void;
  onLevel?: (level: number) => void;
  onEnd?: () => void;
};

let levelTimer: number | null = null;

export function stopSpeaking() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  if (levelTimer) {
    window.clearInterval(levelTimer);
    levelTimer = null;
  }
}

/** Strips code fences / markdown so the assistant does not read syntax aloud. */
export function speakableText(raw: string, limit = 900): string {
  const cleaned = raw
    .replace(/```[\s\S]*?```/g, " — code block omitted from speech — ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_#>]/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned;
}

export function speak(text: string, opts: SpeakOptions = {}) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    opts.onEnd?.();
    return null;
  }
  stopSpeaking();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = opts.rate ?? 1;
  utter.pitch = opts.pitch ?? 0.9;
  utter.volume = opts.volume ?? 1;
  if (opts.voiceName) {
    const voice = window.speechSynthesis.getVoices().find((v) => v.name === opts.voiceName);
    if (voice) utter.voice = voice;
  }

  utter.onstart = () => {
    opts.onStart?.();
    if (opts.onLevel) {
      let t = 0;
      levelTimer = window.setInterval(() => {
        t += 1;
        // Envelope that follows speech cadence without fake randomness spikes.
        const base = 0.45 + 0.35 * Math.abs(Math.sin(t / 3.1));
        const flutter = 0.18 * Math.sin(t / 1.3);
        opts.onLevel?.(Math.max(0.12, Math.min(1, base + flutter)));
      }, 70);
    }
  };
  const finish = () => {
    if (levelTimer) {
      window.clearInterval(levelTimer);
      levelTimer = null;
    }
    opts.onLevel?.(0);
    opts.onEnd?.();
  };
  utter.onend = finish;
  utter.onerror = finish;
  window.speechSynthesis.speak(utter);
  return utter;
}

export function listVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}
