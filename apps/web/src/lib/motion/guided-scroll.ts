import { tick } from "./ticker";

/**
 * Guided scrolling for the landing page.
 *
 * One wheel gesture (or PageDown / Space) moves smoothly to the next "stop", so scroll-driven scenes
 * play like an animation. Stops are:
 *   - the top of every top-level block (children of <main>, and the footer);
 *   - points inside sticky scenes: <el data-scene data-stops="0,0.5,1"> (fractions of the scene progress).
 *   - markers inside long sections: <i data-stop> (optional data-stop-offset in px, e.g. a sticky top).
 * Between distant stops the page glides one screen at a time (with overlap), never skipping content.
 * Touch scrolling is always native.
 * Elements that contain their own scroll (overscroll-behavior: contain, e.g. the ONEKNIGHT demo) are left alone.
 */

const GUIDE_LIMIT = 1.15; // a stop closer than this (in screens) is reached in one move
const PAGE = 0.8; // otherwise glide this share of a screen, keeping context
const GESTURE_GAP_MS = 180; // silence that separates two trackpad/wheel gestures

let enabled = false;
let animating = false;
let stopTween: (() => void) | null = null;
let lastWheelAt = 0;
let lastAbsDelta = 0;
let gestureConsumed = false;

const html = () => document.documentElement;
const calm = () => html().dataset.motion === "calm";
const vh = () => window.innerHeight;
const maxScroll = () => html().scrollHeight - vh();

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function isSticky(scene: Element): boolean {
  const stage = scene.querySelector(":scope > .stage");
  return !!stage && getComputedStyle(stage).position === "sticky";
}

function collectStops(): number[] {
  const y0 = window.scrollY;
  const out: number[] = [0, maxScroll()];
  const blocks = document.querySelectorAll<HTMLElement>("main > *, body > footer, main ~ footer");
  blocks.forEach((el) => out.push(el.getBoundingClientRect().top + y0));
  document.querySelectorAll<HTMLElement>("[data-stop]").forEach((el) => {
    let offset = Number(el.dataset.stopOffset ?? 0);
    if (el.dataset.stopSticky !== undefined && el.nextElementSibling) {
      const cs = getComputedStyle(el.nextElementSibling);
      if (cs.position === "sticky") offset = parseFloat(cs.top) || 0;
    }
    out.push(el.getBoundingClientRect().top + y0 - offset);
  });
  document.querySelectorAll<HTMLElement>("[data-stops]").forEach((el) => {
    const top = el.getBoundingClientRect().top + y0;
    if (!isSticky(el)) return out.push(top);
    const span = el.offsetHeight - vh();
    el.dataset.stops!.split(",").forEach((f) => out.push(top + Number(f) * span));
  });
  const max = maxScroll();
  const sorted = out.map((v) => Math.round(Math.min(max, Math.max(0, v)))).sort((a, b) => a - b);
  return sorted.filter((v, i) => i === 0 || v - sorted[i - 1]! > 4);
}

/** Where one move in `dir` should land: the next stop if it is near, otherwise one page toward it. */
function nextTarget(dir: 1 | -1): number | null {
  const y = window.scrollY;
  const stops = collectStops();
  let stop: number | null = null;
  if (dir > 0) stop = stops.find((s) => s > y + 2) ?? null;
  else for (let i = stops.length - 1; i >= 0; i--) if (stops[i]! < y - 2) { stop = stops[i]!; break; }
  if (stop === null) return null;
  const dist = Math.abs(stop - y);
  if (dist <= vh() * GUIDE_LIMIT) return stop;
  const page = vh() * PAGE;
  // Do not stop just short of a stop: land on the stop instead of leaving a sliver.
  return dist - page < vh() * 0.35 ? stop : y + dir * page;
}

export function smoothScrollTo(target: number, opts: { min?: number; max?: number } = {}) {
  stopTween?.();
  const from = window.scrollY;
  const dist = target - from;
  if (Math.abs(dist) < 1) return;
  if (calm()) {
    window.scrollTo(0, target);
    return;
  }
  const dur = Math.min(opts.max ?? 1250, Math.max(opts.min ?? 650, 620 + (Math.abs(dist) / vh()) * 520));
  const start = performance.now();
  animating = true;
  html().dataset.guided = "true";
  const stop = tick((_, now) => {
    const t = Math.min(1, (now - start) / dur);
    window.scrollTo(0, from + dist * ease(t));
    if (t >= 1) finish();
  });
  const finish = () => {
    stop();
    animating = false;
    stopTween = null;
    delete html().dataset.guided;
  };
  stopTween = finish;
}

/** True when something under the pointer should receive the wheel instead of the page. */
function ownsScroll(target: EventTarget | null, dir: 1 | -1): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body && el !== html()) {
    const cs = getComputedStyle(el);
    const scrollable = /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
    if (scrollable) {
      if (cs.overscrollBehaviorY === "contain" || cs.overscrollBehaviorY === "none") return true;
      const canMove = dir > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
      if (canMove) return true;
    }
    if (el.matches("dialog, input, textarea, select, [data-scroll-free]")) return true;
    el = el.parentElement;
  }
  return false;
}

function blocked(): boolean {
  return !enabled || calm() || html().classList.contains("modal-open");
}

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.deltaY === 0) return;
  const now = e.timeStamp;
  const abs = Math.abs(e.deltaY);
  // A new gesture: a pause that is not just a stalled inertia tail (inertia deltas only decay),
  // or a clear acceleration on top of inertia.
  const decaying = abs < lastAbsDelta;
  const fresh = (now - lastWheelAt > GESTURE_GAP_MS && !decaying) || (abs > lastAbsDelta * 1.8 && abs > 24);
  lastWheelAt = now;
  lastAbsDelta = abs;
  if (fresh) gestureConsumed = false;

  if (blocked()) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  if (ownsScroll(e.target, dir)) return;

  if (animating || gestureConsumed) {
    e.preventDefault();
    return;
  }
  const target = nextTarget(dir);
  if (target === null) return;
  e.preventDefault();
  gestureConsumed = true;
  smoothScrollTo(target);
}

const KEYS: Record<string, 1 | -1> = { PageDown: 1, PageUp: -1, " ": 1 };

function onKey(e: KeyboardEvent) {
  if (blocked() || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target as Element | null;
  if (t?.closest("input, textarea, select, [contenteditable], button, [role='tab'], [role='radio'], dialog")) return;
  let dir = KEYS[e.key];
  if (!dir) return;
  if (e.key === " " && e.shiftKey) dir = -1;
  if (animating) return e.preventDefault();
  const target = nextTarget(dir);
  if (target === null) return;
  e.preventDefault();
  smoothScrollTo(target);
}

/** Same-page anchors glide instead of jumping (and update the URL). */
function onClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest<HTMLAnchorElement>("a[href^='#']");
  if (!a || a.target) return;
  const id = decodeURIComponent(a.hash.slice(1));
  const el = id ? document.getElementById(id) : null;
  if (!el || calm()) return;
  e.preventDefault();
  const target = Math.min(maxScroll(), el.getBoundingClientRect().top + window.scrollY);
  smoothScrollTo(target, { min: 800, max: 1600 });
  history.pushState(null, "", `#${id}`);
  el.focus({ preventScroll: true });
}

const cancel = () => stopTween?.();

export function startGuidedScroll(): () => void {
  enabled = true;
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  document.addEventListener("click", onClick);
  window.addEventListener("pointerdown", cancel, { passive: true });
  window.addEventListener("touchstart", cancel, { passive: true });
  return () => {
    enabled = false;
    cancel();
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("click", onClick);
    window.removeEventListener("pointerdown", cancel);
    window.removeEventListener("touchstart", cancel);
  };
}

/** Programmatic "go to section" used by buttons (for example Відкрити ONEKNIGHT). */
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return false;
  smoothScrollTo(Math.min(maxScroll(), el.getBoundingClientRect().top + window.scrollY), { min: 800, max: 1600 });
  return true;
}
