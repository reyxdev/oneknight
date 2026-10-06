"use client";

import { useEffect, useRef, useState } from "react";
import { EXTRAS, SITE_KINDS, SPRAVA_PRESETS, SPRAVY, portfolioEstimate, type Extra, type SiteKind, type Sprava } from "@oneknight/domain";
import { useDict, useLang } from "@/i18n/provider";
import { fmt, withLang } from "@/i18n";
import { usePortfolioSettings } from "./settings";
import { PfLeadForm } from "./PfLeadForm";

type Kind = SiteKind | "unsure";
type State = { kind: Kind | null; sprava: Sprava | "other" | null; tier: number; extras: Extra[]; touched: boolean; earn: string; step: number; done: boolean };
const KEY = "pf.calc";
const EMPTY: State = { kind: null, sprava: null, tier: 0, extras: [], touched: false, earn: "", step: 0, done: false };

const isSprava = (v: unknown): v is Sprava => SPRAVY.includes(v as Sprava);
const money = (n: number) => n.toLocaleString("uk-UA");

/** A tiny drawing of each kind of site, so the choice is seen, not read (owner's idea, October 2026). */
function SiteSketch({ kind }: { kind: string }) {
  const ink = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg className="pf-sketch" viewBox="0 0 96 68" aria-hidden="true">
      <rect x="2" y="2" width="92" height="64" rx="3" {...ink} />
      {kind !== "unsure" && <path d="M2 11h92" {...ink} />}
      {kind === "card" && (
        <>
          <circle cx="48" cy="26" r="7" {...ink} />
          <path d="M33 40h30M37 46h22" {...ink} />
          <rect x="36" y="52" width="24" height="7" rx="2" className="pf-sketch-fill" />
        </>
      )}
      {kind === "service" && (
        <>
          {[19, 31, 43].map((y) => (
            <g key={y}>
              <path d={`M10 ${y}h40`} {...ink} />
              <rect x="66" y={y - 4} width="20" height="8" rx="2" className="pf-sketch-fill" />
            </g>
          ))}
          <rect x="10" y="53" width="30" height="7" rx="2" {...ink} />
        </>
      )}
      {kind === "shop" && (
        <>
          {[10, 32, 54].map((x) => (
            <g key={x}>
              <rect x={x} y="17" width="18" height="16" rx="2" {...ink} />
              <path d={`M${x} 39h18M${x} 44h11`} {...ink} />
            </g>
          ))}
          <path d="M78 52h8l-2 7h-6zM79 52l-1-3" {...ink} />
          <rect x="10" y="52" width="26" height="7" rx="2" className="pf-sketch-fill" />
        </>
      )}
      {kind === "unsure" && <path d="M38 24c0-7 5-11 10-11s10 4 10 9c0 7-10 8-10 15M48 47v3" {...ink} strokeWidth={3} />}
    </svg>
  );
}

/** The price runs up to the sum in 0.6 s (answers 196, 237); instantly with «less motion». */
function useCountUp(target: number) {
  const [v, setV] = useState(target);
  const from = useRef(0);
  useEffect(() => {
    if (document.documentElement.dataset.motion === "calm") return setV(target);
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 600);
      const e = 1 - (1 - k) ** 3;
      setV(Math.round(a + (target - a) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

/** Reads a shared result (?k=&s=&t=&e=&m=) or a business from «Впізнаєте себе?» (?sprava=). */
function fromUrl(): State | null {
  const q = new URLSearchParams(window.location.search);
  const k = q.get("k");
  if (k && SITE_KINDS.includes(k as SiteKind)) {
    const s = q.get("s");
    return { kind: k as SiteKind, sprava: isSprava(s) ? s : s === "other" ? "other" : null, tier: Number(q.get("t")) || 0, extras: (q.get("e") ?? "").split(".").filter((x): x is Extra => EXTRAS.includes(x as Extra)), touched: true, earn: q.get("m")?.replace(/\D/g, "") ?? "", step: 0, done: true };
  }
  const sp = q.get("sprava");
  if (isSprava(sp)) return { ...EMPTY, sprava: sp, kind: SPRAVA_PRESETS[sp].kind, extras: [...SPRAVA_PRESETS[sp].extras] };
  return null;
}

/**
 * The calculator (answers 119–135, 156–160, 309–312, 396–397, 401–412, 458–469): what site → what business →
 * how many products/services → what to add → earnings per client (optional) → one «≈» price, −25%, 50/50,
 * payback, share, PDF, and the lead form right here.
 */
export function PfCalc({ standalone = false }: { standalone?: boolean }) {
  const d = useDict().pf;
  const t = d.calc;
  const lang = useLang();
  const { prices, placesLeft } = usePortfolioSettings();
  const [s, setS] = useState<State>(EMPTY);
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let init = fromUrl();
    if (!init) {
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) || "null") as State | null;
        if (saved && typeof saved === "object" && "step" in saved) init = { ...EMPTY, ...saved };
      } catch {
        /* nothing saved */
      }
    }
    if (init) setS(init);
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* remembered for this page view only */
    }
  }, [s, ready]);

  const presetKind = s.sprava && s.sprava !== "other" ? SPRAVA_PRESETS[s.sprava].kind : "card";
  const kind: SiteKind = !s.kind || s.kind === "unsure" ? presetKind : s.kind;
  const steps = ["type", "sprava", ...(kind === "card" ? [] : ["count"]), "add", "earn"] as const;
  const step = Math.min(s.step, steps.length - 1);
  const cur = steps[step];
  const earnN = Number(s.earn) || null;
  const est = portfolioEstimate(prices, { kind, tier: s.tier, extras: s.extras, earn: earnN }, placesLeft);
  const shown = useCountUp(s.done ? (est.big ? est.from : est.total) : 0);

  const set = (p: Partial<State>) => setS((x) => ({ ...x, ...p }));
  const go = (n: number) => {
    set({ step: n });
    top.current?.scrollIntoView({ block: "nearest", behavior: document.documentElement.dataset.motion === "calm" ? "auto" : "smooth" });
  };
  const next = () => (step + 1 >= steps.length ? set({ done: true }) : go(step + 1));
  const pickSprava = (v: Sprava | "other") => {
    const preset = v === "other" ? null : SPRAVA_PRESETS[v];
    setS((x) => ({ ...x, sprava: v, extras: x.touched || !preset ? x.extras : [...preset.extras], tier: 0, step: x.step + 1 }));
  };
  const toggle = (e: Extra) => setS((x) => ({ ...x, touched: true, extras: x.extras.includes(e) ? x.extras.filter((y) => y !== e) : [...x.extras, e] }));
  const restart = () => {
    setS(EMPTY);
    setForm(false);
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  };
  const shareUrl = () => {
    const q = new URLSearchParams({ k: kind, s: s.sprava ?? "", t: String(s.tier), e: s.extras.join("."), m: s.earn });
    return `${window.location.origin}${withLang(lang, "/cina/")}?${q}`;
  };
  const share = async () => {
    const url = shareUrl();
    try {
      if (navigator.share) return await navigator.share({ url, title: t.result.title });
      await navigator.clipboard.writeText(url);
      setNote(t.result.copied);
    } catch {
      /* the visitor closed the share sheet */
    }
  };
  const typeTitle = (k: SiteKind) => t.types.items.find((x) => x.id === k)?.title ?? k;
  const spravaLabel = (v: Sprava) => d.solve.cases.find((c) => c.id === v)?.label ?? v;

  return (
    <div className={`pf-calc${standalone ? " pf-calc-page" : ""}`} ref={top}>
      {!s.done ? (
        <div className="pf-calc-card">
          <div className="pf-calc-progress" aria-hidden="true"><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
          <p className="pf-calc-step">{fmt(t.step, { n: step + 1, total: steps.length })}</p>

          {cur === "type" && (
            <fieldset className="pf-q">
              <legend>{t.types.q}</legend>
              <div className="pf-options pf-options-4">
                {t.types.items.map((o) => (
                  <button key={o.id} type="button" className="pf-option" aria-pressed={s.kind === o.id} onClick={() => setS((x) => ({ ...x, kind: o.id as Kind, tier: 0, step: x.step + 1 }))}>
                    <SiteSketch kind={o.id} />
                    <b>{o.title}</b>
                    {o.id !== "unsure" && <em>{fmt(t.types.from, { sum: money(prices.base[o.id as SiteKind]) })}</em>}
                    <span>{o.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {cur === "sprava" && (
            <fieldset className="pf-q">
              <legend>{t.sprava.q}</legend>
              <p className="pf-q-hint">{t.sprava.hint}</p>
              <div className="pf-options pf-options-sprava">
                {SPRAVY.map((v) => (
                  <button key={v} type="button" className="pf-option pf-option-icon" aria-pressed={s.sprava === v} onClick={() => pickSprava(v)}>
                    <img src={`/portfolio/icons/${v}.webp`} width={48} height={48} alt="" />
                    <b>{spravaLabel(v)}</b>
                  </button>
                ))}
                <button type="button" className="pf-option pf-option-icon" aria-pressed={s.sprava === "other"} onClick={() => pickSprava("other")}>
                  <span className="pf-option-more" aria-hidden="true">…</span>
                  <b>{t.sprava.other}</b>
                </button>
              </div>
            </fieldset>
          )}

          {cur === "count" && (
            <fieldset className="pf-q">
              <legend>{kind === "shop" ? t.count.shop.q : t.count.service.q}</legend>
              {s.kind === "unsure" && <p className="pf-recommend">{fmt(t.recommend, { type: typeTitle(kind) })}</p>}
              <div className="pf-options">
                {(kind === "shop" ? t.count.shop.items : t.count.service.items).map((o, i) => (
                  <button key={o} type="button" className="pf-option" aria-pressed={s.tier === i} onClick={() => setS((x) => ({ ...x, tier: i, step: x.step + 1 }))}>
                    <b>{o}</b>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {cur === "add" && (
            <fieldset className="pf-q">
              <legend>{t.add.q}</legend>
              {s.kind === "unsure" && kind === "card" && <p className="pf-recommend">{fmt(t.recommend, { type: typeTitle(kind) })}</p>}
              <div className="pf-checks">
                <label className="pf-check pf-check-gift">
                  <input type="checkbox" checked disabled />
                  <span><b>{t.add.maps}</b><small>{t.add.mapsHint}</small></span>
                  <em>{t.add.gift}</em>
                </label>
                {t.add.items.map((o) => (
                  <label key={o.id} className="pf-check">
                    <input type="checkbox" checked={s.extras.includes(o.id as Extra)} onChange={() => toggle(o.id as Extra)} />
                    <span><b>{o.title}</b><small>{o.hint}</small></span>
                    <em>{money(prices.extras[o.id as Extra])} {t.earn.unit}{o.id === "support" ? t.add.month : ""}</em>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {cur === "earn" && (
            <fieldset className="pf-q">
              <legend><label htmlFor="pf-earn">{t.earn.q}</label></legend>
              <p className="pf-q-hint">{t.earn.hint}</p>
              <div className="pf-earn">
                <input id="pf-earn" inputMode="numeric" value={s.earn} onChange={(e) => set({ earn: e.target.value.replace(/\D/g, "").slice(0, 7) })} placeholder={t.earn.placeholder} onKeyDown={(e) => e.key === "Enter" && next()} />
                <span>{t.earn.unit}</span>
              </div>
            </fieldset>
          )}

          <div className="pf-calc-nav">
            {step > 0 && <button type="button" className="pf-btn pf-btn-ghost" onClick={() => go(step - 1)}>{t.back}</button>}
            {cur === "earn" && !s.earn && <button type="button" className="pf-btn pf-btn-ghost" onClick={next}>{t.skip}</button>}
            {(cur === "add" || (cur === "earn" && !!s.earn) || (cur === "type" && s.kind) || (cur === "sprava" && s.sprava) || (cur === "count" && s.kind)) && (
              <button type="button" className="pf-btn pf-btn-amber" onClick={next}>{t.next}</button>
            )}
          </div>
        </div>
      ) : (
        <div className="pf-calc-card pf-result pf-print-area">
          <p className="pf-calc-step">{t.result.title}: {typeTitle(kind)}{s.sprava && s.sprava !== "other" ? ` · ${spravaLabel(s.sprava)}` : ""}</p>
          {est.big ? (
            <p className="pf-price pf-price-big">{fmt(t.result.big, { sum: money(shown) })}</p>
          ) : (
            <>
              <p className="pf-price" aria-live="polite">{fmt(t.result.approx, { sum: money(shown) })}</p>
              {est.save > 0 && (
                <p className="pf-price-old">
                  <s>{fmt(t.result.old, { sum: money(est.full) })}</s>
                  <b>{fmt(t.result.save, { sum: money(est.save) })}</b>
                </p>
              )}
              <p className="pf-halves">{fmt(t.result.halves, { a: money(est.first), b: money(est.second) })}</p>
              {est.payback && <p className="pf-payback">{fmt(t.result.payback, { n: est.payback })}</p>}
            </>
          )}
          {est.monthly > 0 && <p className="pf-result-line">{fmt(t.result.monthly, { sum: money(est.monthly) })}</p>}
          <p className="pf-result-line">{t.result.yearly}</p>
          <p className="pf-included">{t.result.included}</p>
          {placesLeft > 0 && <p className="pf-places">{fmt(t.result.places, { n: placesLeft })}</p>}
          <div className="pf-result-actions">
            <button type="button" className="pf-btn pf-btn-amber pf-btn-lg" onClick={() => setForm(true)} aria-expanded={form}>{t.result.send}</button>
            <button type="button" className="pf-btn pf-btn-ghost" onClick={share}>{t.result.share}</button>
            <button type="button" className="pf-btn pf-btn-ghost" onClick={() => window.print()}>{t.result.pdf}</button>
            <button type="button" className="pf-link" onClick={restart}>{t.restart}</button>
          </div>
          {note && <p className="pf-form-note" role="status">{note}</p>}
          {form && <PfLeadForm calc={{ kind, tier: s.tier, extras: s.extras, earn: earnN, sprava: s.sprava && s.sprava !== "other" ? s.sprava : null }} />}
        </div>
      )}
    </div>
  );
}
