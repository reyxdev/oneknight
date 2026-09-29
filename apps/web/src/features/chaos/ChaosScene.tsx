"use client";

import { useEffect, useMemo, useRef } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { KnightMark } from "@/components/global/Logo";
import { useDict } from "@/i18n/provider";
import { tick } from "@/lib/motion/ticker";
import { clamp, lerp } from "@/lib/motion/spring";

/** Deterministic PRNG: the same layout on server and client, no hydration drift. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (x: number, a: number, b: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

type P = { bx: number; by: number; ax: number; ay: number; fx: number; fy: number; ph: number; ph2: number; fr: number; ra: number; r0: number; s0: number; birth: number; delay: number };

const SLOTS_DESKTOP = { cols: 4, rows: 3 };
const SLOTS_MOBILE = { cols: 2, rows: 5 };
const CARD_W = 208;
const CARD_H = 68;

export function ChaosScene() {
  const dict = useDict();
  const items = dict.chaos.items;
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const countRef = useRef<HTMLSpanElement>(null);

  // 12 distinct types first (they become the ordered slots), then repeats that get absorbed.
  const total = 40;
  const cards = useMemo(() => {
    const r = rng(20240929);
    return Array.from({ length: total }, (_, i): { item: (typeof items)[number]; n: number; p: P } => ({
      item: items[i % items.length]!,
      n: 1000 + Math.floor(r() * 900),
      p: {
        bx: 0.06 + r() * 0.88,
        by: 0.08 + r() * 0.84,
        ax: 40 + r() * 140,
        ay: 30 + r() * 110,
        fx: 0.35 + r() * 0.9,
        fy: 0.3 + r() * 0.8,
        ph: r() * Math.PI * 2,
        ph2: r() * Math.PI * 2,
        fr: 0.4 + r() * 1.1,
        ra: 4 + r() * 20,
        r0: (r() - 0.5) * 16,
        s0: 0.86 + r() * 0.3,
        birth: i < 12 ? 0.02 + (i / 12) * 0.16 : 0.16 + ((i - 12) / (total - 12)) * 0.42,
        delay: r() * 0.4,
      },
    }));
  }, [items]);

  useEffect(() => {
    const scene = root.current;
    const st = stage.current;
    if (!scene || !st) return;
    let w = 1, h = 1, mobile = false;
    let visible = false;
    let lastCount = -1;
    let t = 0;

    const measure = () => {
      const r = st.getBoundingClientRect();
      w = r.width;
      h = r.height;
      mobile = w < 720;
    };
    const ro = new ResizeObserver(measure);
    ro.observe(st);
    measure();

    const io = new IntersectionObserver((e) => (visible = e[0]?.isIntersecting ?? false), { rootMargin: "20% 0px" });
    io.observe(scene);

    const calm = () => document.documentElement.dataset.motion === "calm";

    const stop = tick((dt) => {
      if (!visible) return;
      t += calm() ? 0 : dt / 1000;
      const p = clamp(Number.parseFloat(scene.style.getPropertyValue("--p")) || 0);
      const chaos = smooth(p, 0.06, 0.6);
      const order = smooth(p, 0.7, 0.92);

      const grid = mobile ? SLOTS_MOBILE : SLOTS_DESKTOP;
      const fw = Math.min(w * 0.92, 980);
      const fh = mobile ? Math.min(h * 0.7, 470) : 400;
      const pad = mobile ? 14 : 24;
      const gap = mobile ? 10 : 14;
      const cw = (fw - pad * 2 - gap * (grid.cols - 1)) / grid.cols;
      const ch = Math.min((fh - pad * 2 - 64 - gap * (grid.rows - 1)) / grid.rows, mobile ? 64 : 80);
      const s = Math.min(cw / CARD_W, ch / CARD_H);
      const fx0 = w / 2 - fw / 2;
      const fy0 = h / 2 - fh / 2 + 24;

      for (let i = 0; i < cards.length; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;
        const c = cards[i]!.p;
        const vis = smooth(p, c.birth, c.birth + 0.05);
        const amp = 0.22 + 1.5 * chaos;
        const fx = c.bx * w + Math.sin(t * c.fx + c.ph) * c.ax * amp;
        const fy = c.by * h + Math.cos(t * c.fy + c.ph2) * c.ay * amp;
        const rot = c.r0 + Math.sin(t * c.fr + c.ph) * c.ra * (0.3 + chaos);
        const o = smooth(order, c.delay * 0.6, c.delay * 0.6 + 0.4);
        const e = o * o * (3 - 2 * o);

        let tx: number, ty: number, ts: number, alpha = vis;
        if (i < grid.cols * grid.rows) {
          const col = i % grid.cols;
          const row = Math.floor(i / grid.cols);
          tx = fx0 + pad + col * (cw + gap) + cw / 2;
          ty = fy0 + pad + 64 + row * (ch + gap) + ch / 2;
          ts = s;
        } else {
          tx = w / 2;
          ty = h / 2;
          ts = 0.05;
          alpha = vis * (1 - smooth(e, 0.55, 1));
        }
        // slight spiral on the way in, so cards are pulled rather than slid
        const swirl = Math.sin(e * Math.PI) * 80 * (1 - e);
        const x = lerp(fx, tx, e) + swirl * Math.cos(c.ph);
        const y = lerp(fy, ty, e) + swirl * Math.sin(c.ph);
        const sc = lerp(c.s0, ts, e) * (0.7 + 0.3 * vis);
        el.style.transform = `translate3d(${(x - CARD_W / 2).toFixed(1)}px,${(y - CARD_H / 2).toFixed(1)}px,0) rotate(${(rot * (1 - e)).toFixed(2)}deg) scale(${sc.toFixed(3)})`;
        el.style.opacity = alpha.toFixed(3);
        el.style.zIndex = String(i < 12 ? 2 : 1);
      }

      if (countRef.current) {
        const n = order > 0.98 ? 0 : Math.round((3 + chaos * 125) * (1 - order));
        if (n !== lastCount) {
          lastCount = n;
          countRef.current.textContent = String(n);
        }
      }
    });
    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
    };
  }, [cards]);

  return (
    <section id="chaos" ref={root} data-chapter data-scene data-stops="0.12,0.32,0.52,0.9" className="chaos scheme-dark" aria-label={dict.chaos.label}>
      <div className="stage chaos-stage" ref={stage}>
        <div className="chaos-frame" aria-hidden="true">
          <div className="chaos-frame-head">
            <span className="chaos-frame-mark"><KnightMark size={28} /></span>
            <span className="chaos-frame-title">ONEKNIGHT</span>
            <span className="pill">{dict.chaos.frameTitle}</span>
          </div>
        </div>

        <div className="chaos-cards" aria-hidden="true">
          {cards.map((c, i) => (
            <div key={i} className="chaos-card" ref={(el) => { cardRefs.current[i] = el; }}>
              <span className="chaos-card-icon"><Icon name={c.item.icon as IconName} size={18} /></span>
              <span className="chaos-card-text">
                <b>{c.item.title}</b>
                <small>{c.item.sub}</small>
              </span>
              {(i % 3 === 0 || c.item.icon === "bell") && <span className="chaos-badge" />}
            </div>
          ))}
        </div>

        <div className="chaos-core" aria-hidden="true">
          <i className="chaos-ring" />
          <KnightMark size={72} />
        </div>

        <div className="chaos-beats">
          {dict.chaos.beats.map((b, i) => (
            <p key={i} className="chaos-beat" style={{ ["--i" as string]: i }}>{b}</p>
          ))}
        </div>

        <div className="chaos-meter" aria-hidden="true">
          <span className="chaos-count num" ref={countRef}>3</span>
          <span>{dict.chaos.counter}</span>
        </div>
        <div className="chaos-wipe" aria-hidden="true" />
      </div>
    </section>
  );
}
