"use client";

import { useEffect, useRef } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt, withLang } from "@/i18n";
import { usePortfolioSettings } from "./settings";

/** Works shown as a screen recording (karpatu.shop scrolls with effects a single long picture can't show). */
const VIDEO = new Set(["karpatu"]);

/** A muted screen recording that plays only while visible; «less motion» keeps the first frame (answers 579, 672). */
function AutoVideo({ src, poster }: { src: string; poster: string }) {
  // `src` without the extension: WebM first, MP4 for browsers without it.
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && document.documentElement.dataset.motion !== "calm") void v.play().catch(() => {});
      else v.pause();
    }, { threshold: 0.25 });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <video ref={ref} poster={poster} muted loop playsInline preload="none" aria-hidden="true">
      <source src={`${src}.webm`} type="video/webm" />
      <source src={`${src}.mp4`} type="video/mp4" />
    </video>
  );
}

/** The site of a work inside a MacBook and an iPhone: a recording or a long picture scrolling by itself. */
export function WorkScreens({ id }: { id: string }) {
  const base = `/portfolio/works/${id}`;
  return (
    <>
      <span className="pf-mac">
        <span className="pf-mac-screen">
          {VIDEO.has(id) ? <AutoVideo src={`${base}-desk`} poster={`${base}-desk.webp`} /> : <img src={`${base}-desk.webp`} alt="" loading="lazy" decoding="async" width={960} height={2267} />}
        </span>
        <span className="pf-mac-base" />
      </span>
      <span className="pf-iphone">
        <span className="pf-iphone-screen">
          {VIDEO.has(id) ? <AutoVideo src={`${base}-phone`} poster={`${base}-phone.webp`} /> : <img src={`${base}-phone.webp`} alt="" loading="lazy" decoding="async" width={520} height={5867} />}
        </span>
      </span>
    </>
  );
}

/**
 * «Не вірте на слово — відкрийте»: real client sites that scroll by themselves inside a MacBook and an iPhone
 * (answers 140, 142, 164, 165, 221, 222, 260, 433, 485).
 */
export function PfWorks() {
  const t = useDict().pf.works;
  const lang = useLang();
  const { buildingNow } = usePortfolioSettings();
  return (
    <section id="roboty" className="pf-section pf-works" aria-labelledby="pf-works-title">
      <div className="pf-wrap">
        <h2 id="pf-works-title" className="pf-h2" data-reveal="up">{t.title}</h2>
        <p className="pf-lead pf-works-lead" data-reveal="up">{t.lead}</p>
        <ul className="pf-works-grid">
          {t.items.map((w) => (
            <li key={w.id} className="pf-work" data-reveal="up">
              <a className="pf-devices" href={w.url} target="_blank" rel="noopener" aria-label={`${t.open}: ${w.host}`}>
                <WorkScreens id={w.id} />
              </a>
              <div className="pf-work-body">
                <h3><a href={w.url} target="_blank" rel="noopener">{w.host}</a></h3>
                <p className="pf-work-what">{w.what}</p>
                <p className="pf-work-label">{t.did}</p>
                <ul className="pf-did">
                  {w.did.map((d) => <li key={d}>{d}</li>)}
                </ul>
                <p className="pf-work-mine">{fmt(t.mine, { list: w.mine.join(", ") })}</p>
                <div className="pf-work-actions">
                  <a className="pf-btn pf-btn-amber pf-btn-sm" href={w.url} target="_blank" rel="noopener">{t.open}</a>
                  <a className="pf-btn pf-btn-ghost pf-btn-sm" href={withLang(lang, `/roboty/${w.id}/`)}>{t.more}</a>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {buildingNow > 0 && <p className="pf-building" data-reveal="up"><span aria-hidden="true" />{fmt(t.building, { n: buildingNow })}</p>}
      </div>
    </section>
  );
}
