"use client";

import { useDict, useLang } from "@/i18n/provider";
import { fmt, withLang } from "@/i18n";
import { usePortfolioSettings } from "./settings";

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
                <span className="pf-mac">
                  <span className="pf-mac-screen"><img src={`/portfolio/works/${w.id}-desk.webp`} alt="" loading="lazy" decoding="async" width={960} height={2250} /></span>
                  <span className="pf-mac-base" />
                </span>
                <span className="pf-iphone">
                  <span className="pf-iphone-screen"><img src={`/portfolio/works/${w.id}-phone.webp`} alt="" loading="lazy" decoding="async" width={520} height={5400} /></span>
                </span>
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
