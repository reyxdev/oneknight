"use client";

import { useId, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { formatUAH, oneknightPricing as P } from "@/data/pricing";
import { Toggle } from "@/components/ui/Toggle";
import { useTween } from "@/lib/motion/useTween";

export function OfferCalc() {
  const t = useDict().offer;
  const lang = useLang();
  const id = useId();
  const [mods, setMods] = useState(2);
  const [support, setSupport] = useState(false);
  const total = P.perMonth + mods * P.modulePerMonth + (support ? P.supportPerMonth : 0);
  const shown = useTween(total, 600);
  return (
    <div className="offer-calc">
      <h3 className="h3">{t.calcTitle}</h3>
      <div className="offer-calc-row">
        <label htmlFor={id}>{t.modules}: <b className="num">{mods}</b></label>
        <input id={id} type="range" min={0} max={9} step={1} value={mods} onChange={(e) => setMods(Number(e.target.value))} data-cursor="drag" />
      </div>
      <Toggle checked={support} onChange={setSupport} label={t.withSupport} />
      <p className="offer-total"><span>{t.total}</span><b className="num" aria-live="polite">{formatUAH(shown, lang)}</b></p>
    </div>
  );
}
