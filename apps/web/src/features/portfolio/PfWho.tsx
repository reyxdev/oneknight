"use client";

import { useState, type CSSProperties } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt, withLang } from "@/i18n";

/** The four most frequent businesses come first (answer 562); «ще 4 справи ↓» opens the rest (626). */
const FIRST = ["shop", "master", "producer", "home"];

/**
 * «Впізнаєте себе?» as a list of big phrases (answers 522, 523, 561, 627, 694): a small 3D sticker, the business under
 * an amber marker, the familiar detail after it. Each phrase opens the calculator with that business.
 */
export function PfWho() {
  const t = useDict().pf.who;
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const calc = withLang(lang, "/cina/");
  const items = [...t.items].sort((a, b) => Number(!FIRST.includes(a.id)) - Number(!FIRST.includes(b.id)));
  const shown = open ? items : items.filter((x) => FIRST.includes(x.id));
  return (
    <section className="pf-section pf-who" aria-labelledby="pf-who-title">
      <div className="pf-wrap pf-narrow">
        <h2 id="pf-who-title" className="pf-h2" data-reveal="up">{t.title}</h2>
        <ul className="pf-who-list">
          {shown.map((it, i) => (
            <li key={it.id} data-reveal="up" style={{ "--i": i % 4 } as CSSProperties}>
              <a className="pf-who-item" href={`${calc}?sprava=${it.id}`}>
                <img className="pf-3d" src={`/portfolio/icons/${it.id}.webp`} width={64} height={64} alt="" loading="lazy" decoding="async" />
                <span>
                  <mark className="pf-mark">{it.title}</mark> {it.text}
                </span>
              </a>
            </li>
          ))}
        </ul>
        {!open && (
          <button type="button" className="pf-link pf-who-more" onClick={() => setOpen(true)} aria-expanded={false}>
            {fmt(t.more, { n: items.length - shown.length })} ↓
          </button>
        )}
        <p className="pf-who-special">
          {t.special} <a href={calc}>{t.specialCta} →</a>
        </p>
      </div>
    </section>
  );
}
