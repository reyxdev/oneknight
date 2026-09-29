"use client";

import { getPrefs } from "./prefs";

/**
 * UI sounds synthesised with Web Audio: no files, no network, no decode latency.
 * Triggered on pointerdown so the audio lands together with the visual press.
 */
export type SoundName = "click" | "toggle" | "success" | "error" | "open" | "close" | "install" | "notify" | "order";
export type SoundProfile = "soft" | "glass" | "wood" | "off";

type Tone = { f: number; f2?: number; d: number; g: number; at?: number; type?: OscillatorType };

const recipes: Record<SoundName, Tone[]> = {
  click: [{ f: 540, f2: 380, d: 0.06, g: 0.9 }],
  toggle: [{ f: 420, f2: 560, d: 0.07, g: 0.8 }],
  success: [{ f: 520, d: 0.09, g: 0.7 }, { f: 780, d: 0.16, g: 0.7, at: 0.07 }],
  error: [{ f: 220, f2: 170, d: 0.16, g: 0.8 }],
  open: [{ f: 360, f2: 520, d: 0.12, g: 0.6 }],
  close: [{ f: 520, f2: 340, d: 0.1, g: 0.5 }],
  install: [{ f: 440, d: 0.08, g: 0.7 }, { f: 660, d: 0.08, g: 0.7, at: 0.07 }, { f: 880, d: 0.18, g: 0.7, at: 0.14 }],
  notify: [{ f: 880, d: 0.1, g: 0.5 }, { f: 1175, d: 0.16, g: 0.5, at: 0.09 }],
  /** New order in the panel: three rising notes, clearly different from the rest. */
  order: [{ f: 660, d: 0.12, g: 0.8 }, { f: 880, d: 0.12, g: 0.8, at: 0.12 }, { f: 1320, d: 0.32, g: 0.8, at: 0.24 }],
};

const profileWave: Record<Exclude<SoundProfile, "off">, { type: OscillatorType; scale: number; decay: number }> = {
  soft: { type: "sine", scale: 1, decay: 1 },
  glass: { type: "triangle", scale: 2.1, decay: 2.2 },
  wood: { type: "square", scale: 0.42, decay: 0.55 },
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
export const soundCore = { profile: "soft" as SoundProfile };

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from a user gesture. */
export function unlockSound() {
  ensure();
}

export function playSound(name: SoundName, opts?: { force?: boolean; profile?: SoundProfile }) {
  if (!opts?.force && !getPrefs().sound) return;
  const profile = opts?.profile ?? soundCore.profile;
  if (profile === "off") return;
  const c = ensure();
  if (!c || !master) return;
  const w = profileWave[profile];
  const t0 = c.currentTime;
  for (const tone of recipes[name]) {
    const start = t0 + (tone.at ?? 0);
    const dur = tone.d * w.decay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = tone.type ?? w.type;
    osc.frequency.setValueAtTime(tone.f * w.scale, start);
    if (tone.f2) osc.frequency.exponentialRampToValueAtTime(tone.f2 * w.scale, start + dur);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(tone.g, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }
  if (profile === "wood" && name === "click") {
    noise ??= makeNoise(c);
    const src = c.createBufferSource();
    const g = c.createGain();
    src.buffer = noise;
    g.gain.setValueAtTime(0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
    src.connect(g).connect(master);
    src.start(t0);
  }
}

function makeNoise(c: AudioContext): AudioBuffer {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.05), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
