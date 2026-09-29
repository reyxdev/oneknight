"use client";

/** Text size of the panel («Мій профіль → Профіль»), remembered on this device. The panel is sized in rem. */
export type TextSize = "normal" | "large" | "larger";
const KEY = "ok.textSize";
const EVENT = "ok:text-size";
const PERCENT: Record<TextSize, string> = { normal: "", large: "112.5%", larger: "125%" };

export function readTextSize(): TextSize {
  try {
    const v = localStorage.getItem(KEY);
    return v === "large" || v === "larger" ? v : "normal";
  } catch {
    return "normal";
  }
}
export function setTextSize(v: TextSize) {
  try {
    localStorage.setItem(KEY, v);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}
/** Applies the size while the panel is shown; the public site keeps its own size. Returns the cleanup. */
export function applyTextSize() {
  const set = () => (document.documentElement.style.fontSize = PERCENT[readTextSize()]);
  set();
  window.addEventListener(EVENT, set);
  return () => {
    window.removeEventListener(EVENT, set);
    document.documentElement.style.fontSize = "";
  };
}
