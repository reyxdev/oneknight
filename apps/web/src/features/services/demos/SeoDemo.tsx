"use client";

import { useState } from "react";
import { useDict } from "@/i18n/provider";
import { Toggle } from "@/components/ui/Toggle";
import { Icon } from "@/components/ui/Icon";

export function SeoDemo() {
  const t = useDict().services.seo;
  const [seo, setSeo] = useState(false);
  const [geo, setGeo] = useState(false);
  const rows = [t.yours, ...t.others];
  const place = (i: number) => (i === 0 ? (seo ? 0 : 4) : seo ? i : i - 1);
  return (
    <div className="demo demo-seo">
      <div className="seo-toggles">
        <Toggle checked={seo} onChange={setSeo} label={t.seoLabel} />
        <Toggle checked={geo} onChange={setGeo} label={t.geoLabel} />
      </div>
      <div className="seo-search"><Icon name="search" size={16} /><span>{t.query}</span></div>
      <div className="seo-ai" data-on={geo} aria-hidden={!geo}>
        <div>
          <p><small><Icon name="bolt" size={12} /> {t.aiTitle}</small>{t.aiText}</p>
          <p className="seo-src">{t.aiSource}: <b>{seo ? t.yours : t.others[0]}</b></p>
        </div>
      </div>
      <ol className="seo-results">
        {rows.map((name, i) => (
          <li key={name} className="seo-row" data-yours={i === 0} style={{ ["--i" as string]: place(i) }}>
            <span className="seo-pos num">{place(i) + 1}</span>
            <span className="seo-txt">
              <b>{name}</b>
              <small>{i === 0 && seo ? t.snippet : t.otherSnippet}</small>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
