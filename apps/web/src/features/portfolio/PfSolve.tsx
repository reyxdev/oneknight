"use client";

import { useState, type CSSProperties } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt, withLang } from "@/i18n";
import { PhoneIcon } from "./PfTop";

/** Accent of each drawn example site, so the three phones feel like a real business. */
const TINT: Record<string, string> = { sto: "#e0533d", shop: "#c2417a", master: "#a8743a", usadba: "#3f8f5a", salon: "#c66b9e", producer: "#e3a21a", home: "#3d7fd1", cafe: "#d9632b" };

/**
 * «Чи вирішить»: the buyer's path Google → your site → a call, drawn for the chosen business (answers 162, 163, 218,
 * 219, 257–259, 428, 484). Drawn sites are marked «приклад».
 */
export function PfSolve() {
  const t = useDict().pf.solve;
  const lang = useLang();
  const [id, setId] = useState(t.cases[0]!.id);
  const c = t.cases.find((x) => x.id === id) ?? t.cases[0]!;
  const tint = { "--tint": TINT[c.id] } as CSSProperties;
  return (
    <section className="pf-section pf-solve" aria-labelledby="pf-solve-title">
      <div className="pf-wrap">
        <h2 id="pf-solve-title" className="pf-h2" data-reveal="up">{t.title}</h2>
        <p className="pf-lead pf-solve-lead" data-reveal="up">{t.lead}</p>
        <div className="pf-chips" role="radiogroup" aria-label={t.pick} data-reveal="up">
          {t.cases.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={x.id === id} className="pf-chip" onClick={() => setId(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <ol className="pf-path" key={c.id} style={tint}>
          <li data-reveal="up" style={{ "--i": 0 } as CSSProperties}>
            <div className="pf-mini" aria-hidden="true">
              <div className="pf-mini-google">
                <span className="pf-g">G</span>
                <span className="pf-mini-search"><span className="pf-typed">{c.q}</span></span>
                <span className="pf-mini-result"><i /><b>{c.name}</b><s /><em className="pf-hand pf-you">← {t.you}</em></span>
                <span className="pf-mini-result pf-dim"><i /><s /><s /></span>
                <span className="pf-mini-result pf-dim"><i /><s /><s /></span>
              </div>
            </div>
            <p><span className="pf-num">1</span>{fmt(t.steps[0]!, { q: c.q })}</p>
          </li>
          <li data-reveal="up" style={{ "--i": 1 } as CSSProperties}>
            <div className="pf-mini" aria-hidden="true">
              <div className="pf-mini-site">
                <em className="pf-example">{t.example}</em>
                <span className="pf-mini-hero"><b>{c.name}</b><i /><i /></span>
                {c.rows.map((r) => (
                  <span key={r} className="pf-mini-row">{r}<s /></span>
                ))}
                <span className="pf-mini-call"><PhoneIcon size={14} />{t.call}</span>
              </div>
            </div>
            <p><span className="pf-num">2</span>{t.steps[1]}</p>
          </li>
          <li data-reveal="up" style={{ "--i": 2 } as CSSProperties}>
            <div className="pf-mini" aria-hidden="true">
              <div className="pf-mini-calling">
                <span className="pf-avatar"><PhoneIcon size={26} /></span>
                <b>{c.name}</b>
                <small>{t.calling}</small>
                <span className="pf-mini-btns"><i className="pf-end"><PhoneIcon size={16} /></i><i className="pf-accept"><PhoneIcon size={16} /></i></span>
              </div>
            </div>
            <p><span className="pf-num">3</span>{t.steps[2]}</p>
          </li>
        </ol>
        <div className="pf-solve-foot" data-reveal="up">
          <p>{t.note}</p>
          <a className="pf-btn pf-btn-amber" href={withLang(lang, `/cina/?sprava=${c.id}`)}>{t.cta}</a>
        </div>
      </div>
    </section>
  );
}
