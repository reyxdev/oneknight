"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH, websiteTypes, type WebsiteTypeId } from "@/data/pricing";
import { featureIcon, typeFeatures } from "@/data/website-types";
import { Icon } from "@/components/ui/Icon";

const StoreDemo = dynamic(() => import("./StoreDemo").then((m) => m.StoreDemo));
const Calculator = dynamic(() => import("./Calculator").then((m) => m.Calculator));

export function PricingPicker() {
  const dict = useDict();
  const lang = useLang();
  const p = dict.pricing;
  const [sel, setSel] = useState<WebsiteTypeId>("shop");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = (websiteTypes.findIndex((t) => t.id === sel) + d + websiteTypes.length) % websiteTypes.length;
    setSel(websiteTypes[i]!.id);
    refs.current[i]?.focus();
  };

  return (
    <div className="pricing">
      <div className="price-grid" role="radiogroup" aria-label={p.pick} onKeyDown={onKey}>
        {websiteTypes.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={sel === t.id}
            tabIndex={sel === t.id ? 0 : -1}
            className="price-card"
            data-reveal="up"
            style={{ ["--i" as string]: i }}
            onClick={() => setSel(t.id)}
          >
            <span className="price-name">{dict.siteTypes[t.id]}</span>
            <span className="price-from num">{fmt(dict.common.from, { price: formatUAH(t.from, lang) })}</span>
            <span className="small price-for">{p.types[t.id].for}</span>
            <ul>
              {p.types[t.id].points.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <span className="price-check" aria-hidden="true"><Icon name="check" size={16} /></span>
          </button>
        ))}
      </div>
      <p className="price-note">{p.note}</p>

      <div className="price-detail" key={sel}>
        <h3 className="h3">{p.included}: <span className="text-accent">{dict.siteTypes[sel]}</span></h3>
        <ul className="feat-grid">
          {typeFeatures[sel].map((f, i) => (
            <li key={f} style={{ ["--i" as string]: i }}>
              <span className="feat-ic"><Icon name={featureIcon[f]} size={18} /></span>
              {p.features[f]}
            </li>
          ))}
        </ul>
      </div>

      {sel === "shop" && <StoreDemo />}

      <Calculator siteType={sel} />
    </div>
  );
}
