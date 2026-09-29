"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { OrderStatus } from "../domain";

export function useFormat() {
  const lang = useLang();
  const d = useDict().ok.notif.ago;
  const locale = lang === "uk" ? "uk-UA" : "en-GB";
  return useMemo(() => {
    const nf = new Intl.NumberFormat(locale);
    const pf = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1, minimumFractionDigits: 1 });
    const df = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
    const dtf = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return {
      money: (n: number) => formatUAH(n, lang),
      num: (n: number) => nf.format(n),
      pct: (n: number) => pf.format(n),
      date: (t: number) => df.format(t),
      dateTime: (t: number) => dtf.format(t),
      ago: (t: number) => {
        const m = Math.round((Date.now() - t) / 60000);
        if (m < 1) return d.now;
        if (m < 60) return fmt(d.min, { n: m });
        if (m < 1440) return fmt(d.h, { n: Math.round(m / 60) });
        return fmt(d.d, { n: Math.round(m / 1440) });
      },
    };
  }, [locale, lang, d]);
}

export function Panel({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`okp ${className}`}>
      {(title || action) && (
        <header className="okp-head">
          {title && <h4>{title}</h4>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, icon, tone }: { label: string; value: ReactNode; sub?: ReactNode; icon?: IconName; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="ok-stat" data-tone={tone}>
      <span className="ok-stat-label">{icon && <Icon name={icon} size={15} />}{label}</span>
      <b className="num">{value}</b>
      {sub && <span className="ok-stat-sub">{sub}</span>}
    </div>
  );
}

export function StatusPill({ status }: { status: OrderStatus }) {
  const t = useDict().ok.orders.status;
  return <span className="ok-pill" data-s={status}>{t[status]}</span>;
}

export function Empty({ icon, text, action }: { icon: IconName; text: string; action?: ReactNode }) {
  return (
    <div className="ok-empty">
      <span><Icon name={icon} size={22} /></span>
      <p>{text}</p>
      {action}
    </div>
  );
}

/** Two-series area/line chart. Plain SVG, scales to its container. */
export function AreaChart({ a, b, labelA, labelB, height = 180 }: { a: number[]; b: number[]; labelA: string; labelB: string; height?: number }) {
  const id = useId().replace(/:/g, "");
  const W = 600;
  const H = height;
  const pad = 6;
  const maxA = Math.max(...a) * 1.1;
  const maxB = Math.max(...b) * 1.6;
  const x = (i: number, n: number) => pad + (i / Math.max(1, n - 1)) * (W - pad * 2);
  const path = (arr: number[], max: number) => arr.map((v, i) => `${i ? "L" : "M"}${x(i, arr.length).toFixed(1)},${(H - pad - (v / max) * (H - pad * 2)).toFixed(1)}`).join("");
  const la = path(a, maxA);
  return (
    <figure className="ok-chart" key={a.length}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${labelA}, ${labelB}`}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--ok-accent)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--ok-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={`${la}L${x(a.length - 1, a.length)},${H}L${x(0, a.length)},${H}Z`} fill={`url(#g${id})`} className="ok-chart-area" />
        <path d={la} fill="none" stroke="var(--ok-accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" className="ok-chart-line" pathLength={1} />
        <path d={path(b, maxB)} fill="none" stroke="var(--fg)" strokeOpacity="0.55" strokeWidth="1.8" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="ok-legend">
        <span><i style={{ background: "var(--ok-accent)" }} />{labelA}</span>
        <span><i style={{ background: "var(--fg)", opacity: 0.55 }} />{labelB}</span>
      </figcaption>
    </figure>
  );
}

/** Short confirmation line inside a screen. Re-triggers on each call. */
export function useFlash() {
  const [f, setF] = useState<{ text: string; n: number; tone: "ok" | "warn" } | null>(null);
  const show = (text: string, tone: "ok" | "warn" = "ok") => setF((p) => ({ text, n: (p?.n ?? 0) + 1, tone }));
  const node = f ? (
    <p className="ok-flash" data-tone={f.tone} role="status" key={f.n} onAnimationEnd={() => setF(null)}>
      {f.text}
    </p>
  ) : null;
  return [node, show] as const;
}

export function notifText(notif: object, n: { key: string; vars: Record<string, string | number> }): string {
  const v = (notif as Record<string, unknown>)[n.key];
  return typeof v === "string" ? fmt(v, n.vars) : n.key;
}
