"use client";

import type { CSSProperties } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { withLang } from "@/i18n";

/** «Чому не шаблон»: the honey story as a chat (answers 167, 215, 261, 477). The comparison lives on /cina (578). */
export function PfCompare() {
  const t = useDict().pf.compare;
  const lang = useLang();
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

        <a className="pf-btn pf-compare-cta" href={`${withLang(lang, "/cina/")}#sposoby`} data-reveal="up">{t.cta} →</a>
      </div>
    </section>
  );
}

/**
 * «Чотири способи отримати сайт» (answers 168–171, 478, 479, 533, 578): instead of a table, each way in plain words —
 * what's good (a pen tick) and what's not (a pen cross). Clear to someone who never heard of Tilda.
 */
export function PfWays() {
  const t = useDict().pf.ways;
  return (
    <section id="sposoby" className="pf-section pf-ways" aria-labelledby="pf-ways-title">
      <div className="pf-wrap">
        <h2 id="pf-ways-title" className="pf-h2">{t.title}</h2>
        <ol className="pf-ways-list">
          {t.items.map((w) => (
            <li key={w.who} className="pf-way" data-mine={"mine" in w && w.mine ? "" : undefined}>
              <h3>{w.who}<small>{w.note}</small></h3>
              <ul>
                {w.plus.map((x) => <li key={x} data-good="">{x}</li>)}
                {w.minus.map((x) => <li key={x} data-bad="">{x}</li>)}
              </ul>
            </li>
          ))}
        </ol>
        <p className="pf-honest">{t.honest}</p>
      </div>
    </section>
  );
}
