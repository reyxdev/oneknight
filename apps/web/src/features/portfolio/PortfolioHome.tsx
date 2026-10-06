import type { CSSProperties, ReactNode } from "react";
import type { Lang } from "@/config";
import { fmt, getDict, withLang } from "@/i18n";
import { LiquidWord } from "@/features/hero/LiquidWord";
import { PfMotion } from "./PfMotion";
import { DiscountSticker, PfMobileBar, PfTop } from "./PfTop";
import { PfWho } from "./PfWho";
import { PfSolve } from "./PfSolve";
import { PfWorks, WorkScreens } from "./PfWorks";
import { PfCompare, PfWays } from "./PfCompare";
import { PfCalc } from "./PfCalc";
import { PfFinal, PfFooter } from "./PfFinal";
import { contacts } from "@/data/contacts";

const contactsTel = contacts.phone.tel;
const contactsDisplay = contacts.phone.display;

const WORD = ["ONE", "KNIGHT"] as const;

/**
 * Pieces of a real client site (karpatu.shop, first screen on a phone) that settle into the phone right after the page
 * opens, within a second (answers 111, 238, 691). `s` = delay step, `x/y/r` = where the piece comes from.
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

/** A wobbly pen underline (answers 516, 633). */
function PenLine({ className = "" }: { className?: string }) {
  return (
    <svg className={`pf-penline ${className}`} viewBox="0 0 300 12" preserveAspectRatio="none" aria-hidden="true">
      <path d="M2 8 C 40 3, 70 11, 110 6 S 190 3, 230 7 S 280 9, 298 4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** Puts the first `mark` inside `text` under the amber marker (answers 557, 607, 659, 697). */
function Marked({ text, mark, draw = false }: { text: string; mark: string; draw?: boolean }) {
  const i = text.indexOf(mark);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className={`pf-mark${draw ? " pf-mark-draw" : ""}`}>{mark}</mark>
      {text.slice(i + mark.length)}
    </>
  );
}

/**
 * The first screen on paper (answers 503–516, 552–560, 594, 653–660): a handwritten hello, the headline with
 * «дзвонили» under the marker, sticker buttons, the trust line; the phone where karpatu.shop assembles, the −25%
 * sticker on its corner; under both, ONEKNIGHT as ink across the whole width.
 */
function Hero({ lang }: { lang: Lang }) {
  const t = getDict(lang).pf.hero;
  return (
    <section className="pf-hero" aria-labelledby="pf-h1">
      <div className="pf-hero-stage">
        <div className="pf-wrap pf-hero-grid">
          <div className="pf-hero-copy">
            <p className="pf-hand pf-kicker">{t.kicker}<PenLine /></p>
            <h1 id="pf-h1" className="pf-h1"><Marked text={t.h1} mark={t.h1Mark} draw /></h1>
            <p className="pf-lead">{t.sub}</p>
            <div className="pf-actions">
              <a className="pf-btn pf-btn-amber pf-btn-lg" href={withLang(lang, "/cina/")}>
                {t.calc}
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </a>
              <a className="pf-btn pf-btn-lg" href="#roboty">{t.works}</a>
            </div>
            <ul className="pf-trust">
              {t.trust.map((x) => (
                <li key={x}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 13c2 1.5 3.5 3 5 5 3-5 6.5-9 11-12" /></svg>
                  <span><Marked text={x} mark={t.trustMark} /></span>
                </li>
              ))}
            </ul>
            <p className="pf-place">{t.place}</p>
          </div>

          <div className="pf-hero-visual">
            <div className="pf-phone-wrap" aria-hidden="true">
              <div className="pf-phone">
                <span className="pf-phone-island" />
                <div className="pf-phone-screen">
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
            <DiscountSticker className="pf-hero-sticker" />
            <p className="pf-hand pf-phone-note" aria-hidden="true">{t.phoneNote} ↑</p>
          </div>
        </div>
        <div className="pf-wrap pf-hero-word" aria-hidden="true">
          <LiquidWord parts={WORD} layout="one" still />
        </div>
      </div>
    </section>
  );
}

function Prices({ lang }: { lang: Lang }) {
  const d = getDict(lang).pf;
  return (
    <section id="cina" className="pf-section pf-prices" aria-labelledby="pf-calc-title">
      <div className="pf-wrap">
        <h2 id="pf-calc-title" className="pf-h2" data-reveal="up">{d.calc.title}</h2>
        <PfCalc />
        <div className="pf-notfor" data-reveal="up">
          <h3>{d.notFor.title}</h3>
          <ul>
            {d.notFor.items.map((x) => (
              <li key={x}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
                {x}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function How({ lang }: { lang: Lang }) {
  const t = getDict(lang).pf.how;
  return (
    <section className="pf-section pf-how" aria-labelledby="pf-how-title">
      <div className="pf-wrap">
        <h2 id="pf-how-title" className="pf-h2" data-reveal="up">{t.title}</h2>
        <ol className="pf-steps">
          {t.steps.map((x, i) => (
            <li key={x.t} data-reveal="up" style={{ "--i": i } as CSSProperties}>
              <span className="pf-step-n">{i + 1}</span>
              <b>{x.t}</b>
              <span>{x.d}</span>
            </li>
          ))}
        </ol>
        <div className="pf-pay" data-reveal="up">
          <div className="pf-pay-bar" aria-hidden="true"><span>50%</span><span>50%</span></div>
          <p className="pf-pay-title">{t.pay}</p>
          <p className="pf-pay-how">{t.payHow}</p>
          <p className="pf-promise">{t.promise}</p>
          <p className="pf-fromyou">{t.fromYou}</p>
        </div>
        <h3 className="pf-h3" data-reveal="up">{t.callTitle}</h3>
        <ol className="pf-asks">
          {t.questions.map((x, i) => (
            <li key={x.q} data-reveal="up" style={{ "--i": i % 3 } as CSSProperties}>
              <b>{x.q}</b>
              <span><em>{t.why}:</em> {x.why}</span>
            </li>
          ))}
        </ol>
        <div className="pf-after" data-reveal="up">
          <h3 className="pf-h3">{t.after.title}</h3>
          <ul>
            {t.after.items.map((x) => (
              <li key={x}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                {x}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function About({ lang }: { lang: Lang }) {
  const t = getDict(lang).pf.about;
  return (
    <section id="pro-mene" className="pf-section pf-about" aria-labelledby="pf-about-title">
      <div className="pf-wrap pf-about-grid">
        <div>
          <h2 id="pf-about-title" className="pf-h2" data-reveal="up">{t.title}</h2>
          {t.text.map((x) => <p key={x} className="pf-about-text" data-reveal="up">{x}</p>)}
        </div>
        <ul className="pf-facts" data-reveal="up">
          {t.facts.map((x) => <li key={x}>{x}</li>)}
        </ul>
      </div>
    </section>
  );
}

function Advice({ lang }: { lang: Lang }) {
  const t = getDict(lang).pf.advice;
  return (
    <section className="pf-section pf-advice" aria-labelledby="pf-advice-title">
      <div className="pf-wrap">
        <h2 id="pf-advice-title" className="pf-h2" data-reveal="up">{t.title}</h2>
        <p className="pf-lead" data-reveal="up">{t.lead}</p>
        <div className="pf-advice-grid">
          {t.items.map((x, i) => (
            <details key={x.t} className="pf-advice-card" data-reveal="up" style={{ "--i": i } as CSSProperties}>
              <summary><span className="pf-step-n">{i + 1}</span>{x.t}</summary>
              <p>{x.d}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq({ lang }: { lang: Lang }) {
  const t = getDict(lang).pf.faq;
  return (
    <section id="pytannia" className="pf-section pf-faq" aria-labelledby="pf-faq-title">
      <div className="pf-wrap pf-faq-wrap">
        <h2 id="pf-faq-title" className="pf-h2" data-reveal="up">{t.title}</h2>
        <div className="pf-faq-list">
          {t.items.map((x) => (
            <details key={x.q} className="pf-faq-item">
              <summary>{x.q}</summary>
              <p>{x.a}</p>
            </details>
          ))}
        </div>
        <a className="pf-btn pf-btn-amber" href={withLang(lang, "/cina/")} data-reveal="up">{t.cta}</a>
      </div>
    </section>
  );
}

/** Every portfolio page: the same header, footer and phone bar around its own content. */
export function PortfolioShell({ children, callOnly = false }: { children: ReactNode; callOnly?: boolean }) {
  return (
    <div className="pf" id="top">
      <PfMotion />
      <PfTop />
      {children}
      <PfFooter />
      <PfMobileBar callOnly={callOnly} />
    </div>
  );
}

/** /cina: the calculator on its own page (answer 134). */
export function PricePage({ lang }: { lang: Lang }) {
  const d = getDict(lang).pf;
  return (
    <PortfolioShell>
      <section className="pf-section pf-page-head pf-prices" aria-labelledby="pf-page-h1">
        <div className="pf-wrap">
          <h1 id="pf-page-h1" className="pf-h1 pf-page-h1">{d.pages.cina.h1}</h1>
          <p className="pf-lead">{d.pages.cina.lead}</p>
          <PfCalc standalone />
          <div className="pf-notfor">
            <h2 className="pf-notfor-title">{d.notFor.title}</h2>
            <ul>
              {d.notFor.items.map((x) => (
                <li key={x}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
                  {x}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
      <PfWays />
      <Faq lang={lang} />
      <PfFinal />
    </PortfolioShell>
  );
}

/** /roboty and /roboty/{id} (answers 223, 326, 327): screenshots → what I did → open the site → work out yours. */
export function WorksPage({ lang }: { lang: Lang }) {
  return (
    <PortfolioShell>
      <div className="pf-page-top" />
      <PfWorks />
      <PfFinal />
    </PortfolioShell>
  );
}

export function WorkPage({ lang, id }: { lang: Lang; id: string }) {
  const d = getDict(lang).pf;
  const w = d.works.items.find((x) => x.id === id)!;
  return (
    <PortfolioShell>
      <section className="pf-section pf-page-head pf-case" aria-labelledby="pf-page-h1">
        <div className="pf-wrap">
          <a className="pf-link pf-back" href={withLang(lang, "/roboty/")}>← {d.pages.work.all}</a>
          <h1 id="pf-page-h1" className="pf-h1 pf-page-h1">{w.host}</h1>
          <p className="pf-lead">{w.what}</p>
          <a className="pf-devices pf-case-devices" href={w.url} target="_blank" rel="noopener" aria-label={fmt(d.pages.work.open, { host: w.host })}>
            <WorkScreens id={w.id} />
          </a>
          <h2 className="pf-h3">{d.works.did}</h2>
          <ul className="pf-did pf-case-did">
            {w.did.map((x) => <li key={x}>{x}</li>)}
          </ul>
          <p className="pf-work-mine">{fmt(d.works.mine, { list: w.mine.join(", ") })}</p>
          <div className="pf-actions">
            <a className="pf-btn pf-btn-ghost pf-btn-lg" href={w.url} target="_blank" rel="noopener">{fmt(d.pages.work.open, { host: w.host })}</a>
            <a className="pf-btn pf-btn-amber pf-btn-lg" href={withLang(lang, `/cina/?sprava=${w.sprava}`)}>{d.pages.work.calc}</a>
          </div>
        </div>
      </section>
    </PortfolioShell>
  );
}

/** A service page (answers 318–320, 380): title → who → what you get → real examples only → calculator → questions → button. */
export function ServicePage({ lang, slug }: { lang: Lang; slug: string }) {
  const d = getDict(lang).pf;
  const t = d.services;
  const it = t.items.find((x) => x.slug === slug)!;
  const examples = d.works.items.filter((w) => it.examples.includes(w.id));
  const others = t.items.filter((x) => x.slug !== slug).slice(0, 3);
  const note = "note" in it ? it.note : null;
  return (
    <PortfolioShell>
      <section className="pf-section pf-page-head pf-service" aria-labelledby="pf-page-h1">
        <div className="pf-wrap">
          <h1 id="pf-page-h1" className="pf-h1 pf-page-h1">{it.h1}</h1>
          <p className="pf-lead">{it.lead}</p>
          <p className="pf-service-price">{it.price}</p>
          <div className="pf-actions">
            <a className="pf-btn pf-btn-amber pf-btn-lg" href="#cina">{d.hero.calc}</a>
            <a className="pf-btn pf-btn-ghost pf-btn-lg" href={contactsTel}>{d.final.call}</a>
          </div>
          <div className="pf-service-grid">
            <div className="pf-service-box">
              <h2 className="pf-h3">{t.who}</h2>
              <ul className="pf-did">{it.who.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div className="pf-service-box">
              <h2 className="pf-h3">{t.get}</h2>
              <ul className="pf-did">{it.get.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
          {note && <p className="pf-service-note">{note}</p>}
          {examples.length > 0 && (
            <>
              <h2 className="pf-h3">{t.example}</h2>
              <ul className="pf-examples">
                {examples.map((w) => (
                  <li key={w.id}>
                    <a href={withLang(lang, `/roboty/${w.id}/`)}>
                      <img src={`/portfolio/works/${w.id}-desk.webp`} alt="" loading="lazy" decoding="async" width={960} height={2250} />
                      <b>{w.host}</b>
                      <span>{w.what}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
      <section id="cina" className="pf-section pf-prices" aria-labelledby="pf-calc-title">
        <div className="pf-wrap">
          <h2 id="pf-calc-title" className="pf-h2">{t.calc}</h2>
          <PfCalc />
        </div>
      </section>
      <section className="pf-section pf-faq" aria-labelledby="pf-sfaq">
        <div className="pf-wrap pf-faq-wrap">
          <h2 id="pf-sfaq" className="pf-h2">{t.faq}</h2>
          <div className="pf-faq-list">
            {it.faq.map((x) => (
              <details key={x.q} className="pf-faq-item">
                <summary>{x.q}</summary>
                <p>{x.a}</p>
              </details>
            ))}
          </div>
          <h2 className="pf-h3">{t.more}</h2>
          <ul className="pf-other-services">
            {others.map((x) => (
              <li key={x.slug}>
                <a href={withLang(lang, `/${x.slug}/`)}><b>{x.nav}</b><span>{x.price}</span></a>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <PfFinal />
    </PortfolioShell>
  );
}

/** /tekhnika (answers 147, 148, 194, 249, 293–295, 321, 322, 395, 492, 493): Kuty and around only, a call only. */
export function TechPage() {
  const t = getDict("uk").pf.tech;
  return (
    <PortfolioShell callOnly>
      <section className="pf-section pf-page-head pf-tech" aria-labelledby="pf-page-h1">
        <div className="pf-wrap">
          <h1 id="pf-page-h1" className="pf-h1 pf-page-h1">{t.h1}</h1>
          <p className="pf-lead">{t.lead}</p>
          <ul className="pf-tech-list">
            {t.prices.map((x) => (
              <li key={x.t}><b>{x.t}</b><span>{x.p}</span></li>
            ))}
          </ul>
          <p className="pf-service-note">{t.visit}</p>
          <div className="pf-contacts">
            <a className="pf-big-phone" href={contactsTel}>{contactsDisplay}</a>
            <p className="pf-hours">{t.hours}</p>
            <a className="pf-btn pf-btn-amber pf-btn-lg" href={contactsTel}>{t.call}</a>
          </div>
        </div>
      </section>
    </PortfolioShell>
  );
}

/** Privacy in plain words (answers 248, 289, 398, 476): what the form sends, who sees it, how to delete. */
export function PrivacyPage({ lang }: { lang: Lang }) {
  const t = getDict(lang).pf.privacy;
  return (
    <PortfolioShell>
      <article className="pf-section pf-page-head pf-privacy" aria-labelledby="pf-page-h1">
        <div className="pf-wrap">
          <h1 id="pf-page-h1" className="pf-h1 pf-page-h1">{t.h1}</h1>
          <p className="pf-service-note">{t.note}</p>
          {t.sections.map((x) => (
            <section key={x.h}>
              <h2 className="pf-h3">{x.h}</h2>
              <p className="pf-about-text">{x.p}</p>
            </section>
          ))}
          <p className="pf-form-note">{t.updated}</p>
        </div>
      </article>
    </PortfolioShell>
  );
}

/** The home page row about computer help (uk only, answers 147, 343). */
function TechRow() {
  const t = getDict("uk").pf.tech;
  return (
    <div className="pf-wrap">
      <a className="pf-tech-row" href="/tekhnika/" data-reveal="up">
        <span>{t.home}</span>
        <em>{t.homeCta} →</em>
      </a>
    </div>
  );
}

/** The new portfolio home page (docs/portfolio/answers.md, order of blocks — answer 151). Built block by block. */
export function PortfolioHome({ lang }: { lang: Lang }) {
  return (
    <PortfolioShell>
      <Hero lang={lang} />
      <PfWho />
      <PfSolve />
      <PfWorks />
      <PfCompare />
      <Prices lang={lang} />
      <How lang={lang} />
      <About lang={lang} />
      <Advice lang={lang} />
      <Faq lang={lang} />
      {lang === "uk" && <TechRow />}
      <PfFinal />
    </PortfolioShell>
  );
}
