import { tick } from "./ticker";
import { clamp, easeOutExpo, makeSpring, stepSpring, type Spring } from "./spring";

/**
 * Attribute-driven motion runtime. Server components declare intent in markup:
 *   data-reveal="up|fade|scale|left|right|blur"   fade/slide in once when visible (stagger with style --i)
 *   data-scene[="pass"]                           writes --p (0..1) while near the viewport (sticky by default)
 *   data-magnetic                                 pointer-attracted (fine pointers, full motion only)
 *   data-count="1240"                             number counter (data-decimals optional)
 *   data-chapter="id"                             marks a page chapter (rail + progress)
 * Nothing here touches React state.
 */

const SEL = "[data-reveal],[data-scene],[data-magnetic],[data-count],[data-chapter]";
const root = () => document.documentElement;
const isCalm = () => root().dataset.motion === "calm";

/* ---------- reveal ---------- */
let revealIO: IntersectionObserver | null = null;
function initReveal() {
  revealIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          (e.target as HTMLElement).dataset.in = "";
          revealIO?.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
  );
}
function addReveal(el: HTMLElement) {
  if (el.dataset.in !== undefined) return;
  if (el.getBoundingClientRect().bottom < 0) {
    el.dataset.in = "";
    return;
  }
  revealIO?.observe(el);
}

/* ---------- scenes and page progress ---------- */
const visibleScenes = new Set<HTMLElement>();
let sceneIO: IntersectionObserver | null = null;
let queued = false;
let lastY = 0;
let dirSince = 0;

function updateScroll() {
  queued = false;
  const vh = window.innerHeight;
  visibleScenes.forEach((el) => {
    const r = el.getBoundingClientRect();
    const p = el.dataset.scene === "pass" ? (vh - r.top) / (vh + r.height) : -r.top / Math.max(1, r.height - vh);
    el.style.setProperty("--p", clamp(p).toFixed(4));
  });
  const y = window.scrollY;
  const max = Math.max(1, root().scrollHeight - vh);
  root().style.setProperty("--page-p", clamp(y / max).toFixed(4));
  const delta = y - lastY;
  if (Math.abs(delta) > 6) {
    dirSince = delta > 0 ? 1 : -1;
    lastY = y;
  }
  const state = y < 40 ? "top" : dirSince > 0 && y > 200 ? "down" : "up";
  if (root().dataset.scroll !== state) root().dataset.scroll = state;
}
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(updateScroll);
}
function initScenes() {
  sceneIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (e.isIntersecting) visibleScenes.add(el);
        else {
          visibleScenes.delete(el);
          const r = el.getBoundingClientRect();
          el.style.setProperty("--p", r.top > 0 ? "0" : "1");
        }
      }
      schedule();
    },
    { rootMargin: "20% 0px 20% 0px" },
  );
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  lastY = window.scrollY;
  schedule();
}

/* ---------- chapters ---------- */
let chapterIO: IntersectionObserver | null = null;
function initChapters() {
  chapterIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = (e.target as HTMLElement).id;
        document.querySelectorAll<HTMLAnchorElement>(".ok-rail a").forEach((a) => {
          a.setAttribute("aria-current", String(a.getAttribute("href") === `#${id}`));
        });
      }
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
}

/* ---------- magnetic ---------- */
type Mag = { el: HTMLElement; sx: Spring; sy: Spring };
const mags = new Set<Mag>();
let magStop: (() => void) | null = null;
let pointer = { x: -9999, y: -9999 };
const finePointer = () => window.matchMedia("(pointer: fine)").matches;

function magLoop(dt: number) {
  let moving = false;
  let anyActive = false;
  mags.forEach((m) => {
    const r = m.el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = pointer.x - cx;
    const dy = pointer.y - cy;
    const reach = Math.max(r.width, r.height) * 0.9;
    const dist = Math.hypot(dx, dy);
    const active = !isCalm() && dist < reach;
    if (active) anyActive = true;
    m.sx.target = active ? dx * 0.28 : 0;
    m.sy.target = active ? dy * 0.28 : 0;
    const x = stepSpring(m.sx, dt, 90);
    const y = stepSpring(m.sy, dt, 90);
    m.el.style.setProperty("--mx", `${x.toFixed(2)}px`);
    m.el.style.setProperty("--my", `${y.toFixed(2)}px`);
    if (Math.abs(x) > 0.05 || Math.abs(y) > 0.05 || Math.abs(m.sx.v) > 0.001) moving = true;
  });
  if (!moving && !anyActive) {
    magStop?.();
    magStop = null;
  }
}
function onPointerMove(e: PointerEvent) {
  pointer = { x: e.clientX, y: e.clientY };
  if (mags.size && !magStop) magStop = tick(magLoop);
}
function addMagnetic(el: HTMLElement) {
  if (!finePointer()) return;
  mags.add({ el, sx: makeSpring(), sy: makeSpring() });
}

/* ---------- counters ---------- */
let countIO: IntersectionObserver | null = null;
function initCounters() {
  countIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        countIO?.unobserve(el);
        runCount(el);
      }
    },
    { threshold: 0.4 },
  );
}
function fmtNum(n: number, decimals: number) {
  const lang = root().lang === "uk" ? "uk-UA" : "en-US";
  return new Intl.NumberFormat(lang, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}
function runCount(el: HTMLElement) {
  const to = Number(el.dataset.count);
  const decimals = Number(el.dataset.decimals ?? 0);
  if (!Number.isFinite(to)) return;
  if (isCalm()) {
    el.textContent = fmtNum(to, decimals);
    return;
  }
  const start = performance.now();
  const dur = 1400;
  const stop = tick((_, now) => {
    const t = clamp((now - start) / dur);
    el.textContent = fmtNum(to * easeOutExpo(t), decimals);
    if (t >= 1) stop();
  });
}
function addCount(el: HTMLElement) {
  const to = Number(el.dataset.count);
  if (!Number.isFinite(to) || el.dataset.counting) return;
  el.dataset.counting = "1";
  el.textContent = fmtNum(0, Number(el.dataset.decimals ?? 0));
  countIO?.observe(el);
}

/* ---------- registration ---------- */
let seen = new WeakSet<Element>();
function register(node: Element) {
  const items: Element[] = [];
  if (node.matches(SEL)) items.push(node);
  node.querySelectorAll(SEL).forEach((n) => items.push(n));
  for (const el of items) {
    if (seen.has(el)) continue;
    seen.add(el);
    const h = el as HTMLElement;
    if (h.hasAttribute("data-reveal")) addReveal(h);
    if (h.hasAttribute("data-scene")) sceneIO?.observe(h);
    if (h.hasAttribute("data-magnetic")) addMagnetic(h);
    if (h.hasAttribute("data-count")) addCount(h);
    if (h.hasAttribute("data-chapter")) chapterIO?.observe(h);
  }
}

let started = false;
export function startMotionRuntime(): () => void {
  if (started) return () => {};
  started = true;
  seen = new WeakSet();
  visibleScenes.clear();
  mags.clear();
  initReveal();
  initScenes();
  initChapters();
  initCounters();
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerleave", () => (pointer = { x: -9999, y: -9999 }));
  register(document.body);
  const mo = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => n instanceof Element && register(n));
  });
  mo.observe(document.body, { childList: true, subtree: true });
  return () => {
    mo.disconnect();
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("pointermove", onPointerMove);
    revealIO?.disconnect();
    sceneIO?.disconnect();
    chapterIO?.disconnect();
    countIO?.disconnect();
    started = false;
  };
}
