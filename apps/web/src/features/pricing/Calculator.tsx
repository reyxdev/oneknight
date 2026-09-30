"use client";

import { useEffect, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH, type WebsiteTypeId } from "@/data/pricing";
import { DEFAULT_CALCULATOR, estimateSite, type CalculatorConfig } from "@oneknight/domain";
import { Icon } from "@/components/ui/Icon";
import { useModal } from "@/components/global/ModalProvider";

/** «від — до» for the chosen type; the numbers are the owner's (admin), the lead gets the same calculation. */
export function Calculator({ siteType }: { siteType: WebsiteTypeId }) {
  const dict = useDict();
  const lang = useLang();
  const t = dict.pricing.calc;
  const { openOrder } = useModal();
  const [cfg, setCfg] = useState<CalculatorConfig>(DEFAULT_CALCULATOR);
  const [products, setProducts] = useState(String(DEFAULT_CALCULATOR.products[0]!.max));
  const [design, setDesign] = useState<"ready" | "custom">("ready");
  const [languages, setLanguages] = useState(1);
  const [content, setContent] = useState(0);
  useEffect(() => {
    void fetch("/api/site/calculator")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: CalculatorConfig | null) => c && setCfg(c))
      .catch(() => {});
  }, []);
  const tierKey = (max: number | null) => (max === null ? "more" : String(max));
  const input = { siteType, products, design, languages, content };
  const est = estimateSite(cfg, input);
  let prev = 0;
  const tiers = cfg.products.map((x) => {
    const label = x.max === null ? fmt(t.more, { n: prev }) : fmt(t.upTo, { n: x.max });
    if (x.max !== null) prev = x.max;
    return { key: tierKey(x.max), label };
  });
  return (
    <div className="calc card" id="calculator">
      <div className="calc-fields">
        <h3 className="h3">{fmt(t.title, { type: dict.siteTypes[siteType] })}</h3>
        <label className="calc-field">
          <span>{siteType === "shop" ? t.products : t.pages}</span>
          <select className="input" value={products} onChange={(e) => setProducts(e.target.value)}>
            {tiers.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
        <fieldset className="calc-field">
          <legend>{t.design}</legend>
          <div className="flex flex-wrap gap-2">
            {(["ready", "custom"] as const).map((d) => (
              <label key={d} className="chip" data-on={design === d}>
                <input type="radio" className="sr-only" name="calc-design" checked={design === d} onChange={() => setDesign(d)} />
                {t.designs[d]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="calc-field">
          <legend>{t.languages}</legend>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3].map((n) => (
              <label key={n} className="chip" data-on={languages === n}>
                <input type="radio" className="sr-only" name="calc-langs" checked={languages === n} onChange={() => setLanguages(n)} />
                {n}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="calc-field">
          <span>{t.content}</span>
          <input className="input" type="number" min={0} max={1000} step={10} value={content} onChange={(e) => setContent(Math.max(0, Math.min(1000, Number(e.target.value) || 0)))} />
          <small className="small">{t.contentHint}</small>
        </label>
      </div>
      <div className="calc-result" aria-live="polite">
        <span className="small">{t.result}</span>
        <b className="calc-sum num">{formatUAH(est.from, lang)} — {formatUAH(est.to, lang)}</b>
        <p className="small">{t.note}</p>
        <button type="button" className="btn btn-lg" data-magnetic onClick={() => openOrder("brief", { siteType, estimate: { ...input, ...est } })}>
          {t.order}
          <Icon name="arrow" size={18} />
        </button>
      </div>
    </div>
  );
}
