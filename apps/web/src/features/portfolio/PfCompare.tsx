"use client";

import { useState, type CSSProperties } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { withLang } from "@/i18n";

/**
 * «Чому не шаблон»: the honey story as a chat (answers 167, 215, 261, 477) and the honest table Tilda/Wix · Prom ·
 * nephew · Ivan (168–171, 478, 479); on phones Ivan against one chosen column (429).
 */
export function PfCompare() {
  const t = useDict().pf.compare;
  const lang = useLang();
  const [pick, setPick] = useState(0);
  const s = t.story;
  return (
    <section className="pf-section pf-compare" aria-labelledby="pf-compare-title">
      <div className="pf-wrap">
        <h2 id="pf-compare-title" className="pf-h2" data-reveal="up">{t.title}</h2>
        <div className="pf-story">
          <div className="pf-chat" aria-label={s.you}>
            <p className="pf-chat-head">{s.you}</p>
            <p className="pf-chat-sys" data-reveal="fade" style={{ "--i": 0 } as CSSProperties}><small>{s.fri}</small>{s.blocked}</p>
            <p className="pf-bubble" data-reveal="up" style={{ "--i": 2 } as CSSProperties}>
              <small>{s.sat}</small>
              {s.toYou}
              <em>{s.unread}</em>
            </p>
          </div>
          <div className="pf-chat pf-chat-good" aria-label={s.neighbour}>
            <p className="pf-chat-head">{s.neighbour}</p>
            <p className="pf-bubble" data-reveal="up" style={{ "--i": 4 } as CSSProperties}>
              <small>{s.sat2}</small>
              {s.toNeighbour}
            </p>
          </div>
          <p className="pf-moral" data-reveal="up">{s.moral}</p>
        </div>

        <div className="pf-table-pick" role="radiogroup" aria-label={t.pick}>
          <span>{t.pick}</span>
          {t.cols.slice(0, 3).map((c, i) => (
            <button key={c} type="button" role="radio" aria-checked={pick === i} className="pf-chip" onClick={() => setPick(i)}>{c}</button>
          ))}
        </div>
        <div className="pf-table-wrap" data-reveal="up">
          <table className="pf-table" data-pick={pick}>
            <thead>
              <tr>
                <td />
                {t.cols.map((c, i) => <th key={c} scope="col" data-c={i}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.q}>
                  <th scope="row">{r.q}</th>
                  {r.v.map((v, i) => <td key={i} data-c={i}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pf-honest" data-reveal="up">{t.honest}</p>
        <div className="pf-compare-foot" data-reveal="up">
          <p>{t.nephew}</p>
          <a className="pf-btn pf-btn-amber" href={withLang(lang, "/cina/")}>{t.cta}</a>
        </div>
      </div>
    </section>
  );
}
