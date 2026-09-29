"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { karpatu } from "@/content/karpatu";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon, type IconName } from "@/components/ui/Icon";

const KEYS = ["design", "structure", "functionality", "seo", "geo", "tech"] as const;
const ICONS: Record<(typeof KEYS)[number], IconName> = { design: "layers", structure: "table", functionality: "cart", seo: "search", geo: "bolt", tech: "shield" };

export function CaseLayers() {
  const t = useDict().karpatu;
  const lang = useLang();
  const [k, setK] = useState<(typeof KEYS)[number]>("design");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const f = karpatu.facts;
  const vals = { urls: f.sitemapUrls, variants: f.catalogVariants, langs: f.languages, schema: f.structuredData.join(", ") };
  const date = new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(karpatu.verifiedOn));
  const layer = t.layers[k];

  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (KEYS.indexOf(k) + d + KEYS.length) % KEYS.length;
    setK(KEYS[n]!);
    refs.current[n]?.focus();
  };

  return (
    <div className="kp-layers">
      <div className="kp-tabs" role="tablist" aria-label={t.layersLabel} onKeyDown={onKey}>
        {KEYS.map((key, n) => (
          <button
            key={key}
            ref={(el) => { refs.current[n] = el; }}
            type="button"
            role="tab"
            id={`kp-tab-${key}`}
            aria-selected={k === key}
            aria-controls="kp-panel"
            tabIndex={k === key ? 0 : -1}
            onClick={() => setK(key)}
          >
            <Icon name={ICONS[key]} size={18} />
            {t.layers[key].name}
          </button>
        ))}
      </div>
      <div className="kp-panel" role="tabpanel" id="kp-panel" aria-labelledby={`kp-tab-${k}`} key={k}>
        <h3 className="h3">{layer.title}</h3>
        <ul>
          {layer.points.map((p) => (
            <li key={p}>
              <Icon name="check" size={16} />
              {fmt(p, vals)}
            </li>
          ))}
        </ul>
        <p className="kp-verified"><Icon name="shield" size={14} />{fmt(t.verified, { date })}</p>
      </div>
    </div>
  );
}
