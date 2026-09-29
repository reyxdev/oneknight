"use client";

import { useSyncExternalStore } from "react";
import { config } from "@/config";

export type Prefs = {
  theme: "system" | "light" | "dark";
  sound: boolean;
  motion: "full" | "calm";
  /** Set once the reduced-motion hint has been answered. */
  hintSeen: boolean;
};

export const PREFS_KEY = "ok.prefs";

const defaults: Prefs = {
  theme: "system",
  sound: config.sound.defaultEnabled,
  motion: config.motion.defaultMode,
  hintSeen: false,
};

let state: Prefs = defaults;
let hydrated = false;
const listeners = new Set<() => void>();

function read(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Prefs>) } : defaults;
  } catch {
    return defaults;
  }
}

export function resolveTheme(theme: Prefs["theme"]): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(p: Prefs) {
  const el = document.documentElement;
  el.dataset.theme = resolveTheme(p.theme);
  el.dataset.motion = p.motion;
}

function emit() {
  listeners.forEach((l) => l());
}

export function initPrefs() {
  if (hydrated) return;
  hydrated = true;
  state = read();
  apply(state);
  emit();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.theme === "system") apply(state);
  });
  window.addEventListener("storage", (e) => {
    if (e.key === PREFS_KEY) {
      state = read();
      apply(state);
      emit();
    }
  });
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  state = { ...state, [key]: value };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(state));
  } catch {
    /* storage may be blocked; preference then lasts for this page view only */
  }
  apply(state);
  emit();
}

export const getPrefs = () => state;

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => defaults,
  );
}

/** Inline script run before first paint: no theme flash, `js` class for reveal styles. */
export const bootScript = `(function(){var d=document.documentElement;d.classList.add('js');try{var p=JSON.parse(localStorage.getItem('${PREFS_KEY}')||'{}');var t=p.theme||'system';d.dataset.theme=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;d.dataset.motion=p.motion||'${config.motion.defaultMode}';}catch(e){d.dataset.theme='light';d.dataset.motion='${config.motion.defaultMode}';}})();`;
