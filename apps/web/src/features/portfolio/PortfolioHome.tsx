import type { CSSProperties } from "react";
import type { Lang } from "@/config";
import { getDict, withLang } from "@/i18n";
import { LiquidWord } from "@/features/hero/LiquidWord";
import { PfMotion } from "./PfMotion";
import { PfMobileBar, PfTop } from "./PfTop";

const WORD = ["ONE", "KNIGHT"] as const;

/**
 * Pieces of a real client site (karpatu.shop, first screen on a phone) that fly into the phone while the first
 * screen scrolls (answers 111, 238, 381). `s` = where on the scroll the piece starts, `x/y/r` = where it comes from.
 */
const PIECES = [
  { id: "header", w: 600, h: 131, s: 0, x: "0%", y: "-70%", r: "0deg" },
  { id: "photo", w: 600, h: 454, s: 0.08, x: "-46%", y: "-4%", r: "-8deg" },
  { id: "text", w: 600, h: 677, s: 0.16, x: "42%", y: "8%", r: "6deg" },
] as const;
const CARDS = [
  { id: "card1", w: 360, h: 454, s: 0.26 },
  { id: "card2", w: 360, h: 473, s: 0.34 },
] as const;

function Hero({ lang }: { lang: Lang }) {
  const t = getDict(lang).pf.hero;
  return (
    <section className="pf-hero" data-scene aria-labelledby="pf-h1">
      <div className="pf-hero-stage">
        <div className="pf-wrap pf-hero-grid">
          <div className="pf-hero-copy">
            <p className="pf-kicker">{t.kicker}</p>
            <h1 id="pf-h1" className="pf-h1">{t.h1}</h1>
            <p className="pf-lead">{t.sub}</p>
            <div className="pf-actions">
              <a className="pf-btn pf-btn-amber pf-btn-lg" href={withLang(lang, "/cina/")}>
                {t.calc}
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </a>
              <a className="pf-btn pf-btn-ghost pf-btn-lg" href="#roboty">{t.works}</a>
            </div>
            <ul className="pf-trust">
              {t.trust.map((x) => (
                <li key={x}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                  {x}
                </li>
              ))}
            </ul>
            <p className="pf-place">{t.place}</p>
          </div>

          <div className="pf-hero-visual" aria-hidden="true">
            <div className="pf-liquid"><LiquidWord parts={WORD} layout="two" dark /></div>
            <div className="pf-phone-wrap">
              <div className="pf-phone">
                <span className="pf-phone-island" />
                <div className="pf-phone-screen">
                  <span className="pf-skeleton" />
                  {PIECES.map((p) => (
                    <img
                      key={p.id}
                      className="pf-piece"
                      src={`/portfolio/karpatu/${p.id}.webp`}
                      width={p.w}
                      height={p.h}
                      alt=""
                      decoding="async"
                      style={{ "--s": p.s, "--x": p.x, "--y": p.y, "--r": p.r } as CSSProperties}
                    />
                  ))}
                </div>
              </div>
              {CARDS.map((c) => (
                <img key={c.id} className={`pf-card pf-${c.id}`} src={`/portfolio/karpatu/${c.id}.webp`} width={c.w} height={c.h} alt="" decoding="async" loading="lazy" style={{ "--s": c.s } as CSSProperties} />
              ))}
            </div>
            <p className="pf-phone-note">{t.phoneNote}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function WhoFor({ lang }: { lang: Lang }) {
  const t = getDict(lang).pf.who;
  const calc = withLang(lang, "/cina/");
  return (
    <section className="pf-section pf-who" aria-labelledby="pf-who-title">
      <div className="pf-wrap">
        <h2 id="pf-who-title" className="pf-h2" data-reveal="up">{t.title}</h2>
        <ul className="pf-who-grid">
          {t.items.map((it, i) => (
            <li key={it.id} data-reveal="up" style={{ "--i": i % 4 } as CSSProperties}>
              <a className="pf-who-card" href={`${calc}?sprava=${it.id}`}>
                <img src={`/portfolio/icons/${it.id}.webp`} width={96} height={96} alt="" loading="lazy" decoding="async" />
                <b>{it.title}</b>
                <span>{it.text}</span>
                <em>
                  {t.calc}
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </em>
              </a>
            </li>
          ))}
        </ul>
        <div className="pf-who-special" data-reveal="up">
          <p>{t.special}</p>
          <a className="pf-btn pf-btn-ghost" href={calc}>{t.specialCta}</a>
        </div>
      </div>
    </section>
  );
}

/** The new portfolio home page (docs/portfolio/answers.md, order of blocks — answer 151). Built block by block. */
export function PortfolioHome({ lang }: { lang: Lang }) {
  return (
    <div className="pf">
      <PfMotion />
      <PfTop />
      <Hero lang={lang} />
      <WhoFor lang={lang} />
      <PfMobileBar />
    </div>
  );
}
