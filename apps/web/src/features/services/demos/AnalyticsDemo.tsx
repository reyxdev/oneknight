"use client";

import { useState } from "react";
import { servicesDemo } from "@/data/services.demo";
import { useDict, useLang } from "@/i18n/provider";
import { Segmented } from "@/components/ui/Toggle";

export function AnalyticsDemo() {
  const t = useDict().services.analytics;
  const lang = useLang();
  const [view, setView] = useState<"raw" | "clear">("raw");
  const d = servicesDemo.analytics;
  const max = Math.max(...d.sources.map((s) => s.visits));
  const nf = new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-US");
  return (
    <div className="demo demo-an" data-view={view}>
      <Segmented
        label={t.mode}
        value={view}
        onChange={setView}
        options={[
          { v: "raw", t: t.raw },
          { v: "clear", t: t.clear },
        ]}
      />
      <div className="an-stage">
        <pre className="an-raw" aria-hidden={view !== "raw"}>
          {d.rawLines.join("\n")}
        </pre>
        <div className="an-clear" aria-hidden={view !== "clear"}>
          <div className="an-kpi">
            {t.kpi.map((k, i) => (
              <div key={k}>
                <b className="num">{nf.format(d.kpi[i]!)}</b>
                <span>{k}</span>
              </div>
            ))}
          </div>
          <div className="an-bars">
            {t.sources.map((s, i) => (
              <div key={s} className="an-bar">
                <span>{s}</span>
                <i style={{ ["--w" as string]: d.sources[i]!.visits / max }} />
                <b className="num">{d.sources[i]!.visits}</b>
              </div>
            ))}
          </div>
          <p className="an-insight"><small>{t.insightLabel}</small>{t.insight}</p>
        </div>
      </div>
    </div>
  );
}
