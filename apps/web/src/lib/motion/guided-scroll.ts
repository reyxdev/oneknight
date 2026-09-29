import { tick } from "./ticker";

/**
 * Guided scrolling, only where the page is a scroll-driven animation.
 *
 * Inside a sticky scene (<section data-scene data-stops="0.12,0.32,...">) one wheel gesture, PageDown or
 * Space plays the animation to the next keyframe and stops there. Keyframes are the meaningful frames of
 * the scene; the last one is the scene's finished state. The next gesture leaves the scene: it glides
 * through the transition straight to the next block (or to the first keyframe of the next scene), so a
 * half-finished or blank transition frame is never where the page rests.
 *
 * Everywhere else scrolling is completely native. Touch scrolling is always native.
 */

const CATCH = 0.6; // entering a scene from above: snap to its first keyframe when this close (in screens)
const GESTURE_GAP_MS = 180;

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

type Scene = { top: number; keys: number[]; exit: number; end: number };

function isSticky(scene: Element): boolean {
  const stage = scene.querySelector(":scope > .stage");
  return !!stage && getComputedStyle(stage).position === "sticky";
}

function sceneAt(el: HTMLElement, y0: number): Scene | null {
  if (!isSticky(el)) return null;
  const top = el.getBoundingClientRect().top + y0;
  const span = el.offsetHeight - vh();
  const keys = el.dataset.stops!.split(",").map((f) => Math.round(top + Number(f) * span));
  return { top, keys, exit: 0, end: top + el.offsetHeight };
}

/** The block that follows a scene: its next sibling, or the next sibling of its parent section. */
function nextBlock(el: HTMLElement): HTMLElement | null {
  let n: Element | null = el.nextElementSibling;
  if (!n && el.parentElement && el.parentElement.tagName !== "MAIN") n = el.parentElement.nextElementSibling;
  if (!n) n = document.querySelector("body > footer, main ~ footer");
  return n as HTMLElement | null;
}

function scenes(): Scene[] {
  const y0 = window.scrollY;
  const els = [...document.querySelectorAll<HTMLElement>("[data-stops]")];
  const list = els.map((el) => ({ el, s: sceneAt(el, y0) }));
  for (const { el, s } of list) {
    if (!s) continue;
    const next = nextBlock(el);
    let exit = next ? next.getBoundingClientRect().top + y0 : s.end;
    // The next block is itself a scene (or starts with one): land on its first keyframe.
    const chained = list.find((o) => o.s && o.el !== el && Math.abs(o.s.top - exit) < 4);
    if (chained?.s) exit = chained.s.keys[0]!;
    s.exit = Math.min(maxScroll(), Math.round(exit));
  }
  return list.map((o) => o.s).filter((s): s is Scene => !!s);
}

/** Where one move should land, or null to let the browser scroll natively. */
function target(dir: 1 | -1): number | null {
  const y = window.scrollY;
  for (const s of scenes()) {
    const first = s.keys[0]!;
    const last = s.keys[s.keys.length - 1]!;
    if (dir > 0) {
      if (y < first - 2) {
        if (y >= s.top - vh() * CATCH) return first; // entering from above
        continue;
      }
      if (y < s.exit - 2 && y < s.end) return s.keys.find((k) => k > y + 2) ?? s.exit;
    } else {
      if (y > last + 2 && y <= s.exit + 2) return last; // coming back up from the next block
      if (y > first + 2 && y <= last + 2) {
        for (let i = s.keys.length - 1; i >= 0; i--) if (s.keys[i]! < y - 2) return s.keys[i]!;
      }
    }
  }
  return null;
}

export function smoothScrollTo(to: number, opts: { min?: number; max?: number } = {}) {
  stopTween?.();
  const from = window.scrollY;
  const dist = to - from;
  if (Math.abs(dist) < 1) return;
  if (calm()) {
    window.scrollTo(0, to);
    return;
  }
  const dur = Math.min(opts.max ?? 1300, Math.max(opts.min ?? 700, 650 + (Math.abs(dist) / vh()) * 450));
  const start = performance.now();
  animating = true;
  const stop = tick((_, now) => {
    const t = Math.min(1, (now - start) / dur);
    window.scrollTo(0, from + dist * ease(t));
    if (t >= 1) finish();
  });
  const finish = () => {
    stop();
    animating = false;
    stopTween = null;
  };
  stopTween = finish;
}

/** True when something under the pointer should receive the wheel instead of the page. */
function ownsScroll(el0: EventTarget | null, dir: 1 | -1): boolean {
  let el = el0 instanceof Element ? el0 : null;
  while (el && el !== document.body && el !== html()) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
      if (cs.overscrollBehaviorY === "contain" || cs.overscrollBehaviorY === "none") return true;
      if (dir > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
    }
    if (el.matches("dialog, input, textarea, select, [data-scroll-free]")) return true;
    el = el.parentElement;
  }
  return false;
}

const blocked = () => !enabled || calm() || html().classList.contains("modal-open");

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.deltaY === 0) return;
  const now = e.timeStamp;
  const abs = Math.abs(e.deltaY);
  // New gesture: a pause that is not a stalled inertia tail, or a clear acceleration.
  const fresh = (now - lastWheelAt > GESTURE_GAP_MS && abs >= lastAbsDelta) || (abs > lastAbsDelta * 1.8 && abs > 24);
  lastWheelAt = now;
  lastAbsDelta = abs;
  if (fresh) gestureConsumed = false;

  if (blocked()) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  if (ownsScroll(e.target, dir)) return;
  if (animating) return e.preventDefault();
  const to = target(dir);
  if (gestureConsumed) {
    // The rest of a gesture that already moved the page (trackpad inertia) must not start another move.
    if (to !== null) e.preventDefault();
    return;
  }
  if (to === null) return; // native
  e.preventDefault();
  gestureConsumed = true;
  smoothScrollTo(to);
}

const KEYS: Record<string, 1 | -1> = { PageDown: 1, PageUp: -1, " ": 1, ArrowDown: 1, ArrowUp: -1 };

function onKey(e: KeyboardEvent) {
  if (blocked() || e.altKey || e.ctrlKey || e.metaKey) return;
  const el = e.target as Element | null;
  if (el?.closest("input, textarea, select, [contenteditable], button, [role='tab'], [role='radio'], [role='switch'], dialog")) return;
  let dir = KEYS[e.key];
  if (!dir) return;
  if (e.key === " " && e.shiftKey) dir = -1;
  const to = target(dir);
  if (to === null) return;
  e.preventDefault();
  if (!animating) smoothScrollTo(to);
}

/** Same-page anchors glide instead of jumping (and update the URL). */
function onClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest<HTMLAnchorElement>("a[href^='#']");
  if (!a || a.target) return;
  const id = decodeURIComponent(a.hash.slice(1));
  if (!id || !document.getElementById(id) || calm()) return;
  e.preventDefault();
  scrollToId(id);
  history.pushState(null, "", `#${id}`);
}

/** Go to a block. A scene is entered at its first keyframe, so it never opens on a blank frame. */
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return false;
  let to = el.getBoundingClientRect().top + window.scrollY;
  const scene = el.matches("[data-stops]") ? el : el.querySelector<HTMLElement>(":scope > [data-stops]");
  const s = scene ? sceneAt(scene, window.scrollY) : null;
  if (s) to = s.keys[0]!;
  smoothScrollTo(Math.min(maxScroll(), to), { min: 800, max: 1600 });
  return true;
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
