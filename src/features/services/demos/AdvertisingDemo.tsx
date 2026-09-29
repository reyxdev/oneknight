"use client";

import { useState } from "react";
import { servicesDemo } from "@/data/services.demo";
import { useDict, useLang } from "@/i18n/provider";
import { useTween } from "@/lib/motion/useTween";
import { Icon } from "@/components/ui/Icon";

export function AdvertisingDemo() {
  const t = useDict().services.advertising;
  const lang = useLang();
  const [step, setStep] = useState(0);
  const m = servicesDemo.advertising[step]!;
  const shown = useTween(m.shown);
  const clicks = useTween(m.clicks);
  const leads = useTween(m.leads);
  const cpa = m.leads ? Math.round(m.budget / m.leads) : 0;
  const cpaShown = useTween(cpa);
  const nf = new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-US");
  const maxLeads = 38;
  return (
    <div className="demo demo-ads">
      <ol className="ads-steps" aria-label="Кроки">
        {t.steps.map((s, i) => (
          <li key={s}>
            <button type="button" aria-current={step === i ? "step" : undefined} data-done={i < step} onClick={() => setStep(i)} data-sound="toggle">
              <span>{i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>
      <p className="ads-text" aria-live="polite">{t.stepText[step]}</p>
      <div className="ads-metrics">
        <div><b className="num">{nf.format(shown)}</b><span>{t.shown}</span></div>
        <div><b className="num">{nf.format(clicks)}</b><span>{t.clicks}</span></div>
        <div><b className="num">{nf.format(leads)}</b><span>{t.leads}</span></div>
        <div><b className="num">{m.leads ? `${cpaShown} ${t.currency}` : "—"}</b><span>{t.cpa}</span></div>
      </div>
      <svg className="ads-spark" viewBox="0 0 240 56" preserveAspectRatio="none" aria-hidden="true">
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={servicesDemo.advertising
            .slice(0, step + 1)
            .map((p, i) => `${(i / 5) * 236 + 2},${52 - (p.leads / maxLeads) * 46}`)
            .join(" ")}
        />
      </svg>
      <div className="ads-actions">
        <button type="button" className="btn btn-sm" onClick={() => setStep((s) => (s + 1) % 6)}>
          {step === 5 ? t.restart : t.next}
          <Icon name={step === 5 ? "refresh" : "arrow"} size={16} />
        </button>
      </div>
    </div>
  );
}
