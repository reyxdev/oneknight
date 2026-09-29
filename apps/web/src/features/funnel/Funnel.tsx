"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { funnelDemo } from "@/data/funnel.demo";
import { useDict, useLang } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";

const stages = funnelDemo.stages;
const top = stages[0].users;

/** Log scale so the last stages stay visible: 10,000 -> full width, 12 -> about a quarter. */
const widthOf = (n: number) => Math.max(0.24, Math.log10(n) / Math.log10(top));

export function Funnel() {
  const dict = useDict();
  const lang = useLang();
  const f = dict.funnel;
  const [sel, setSel] = useState<number>(funnelDemo.defaultStage);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const nf = new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-US");
  const pf = new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 1 });

  const cur = stages[sel]!;
  const prev = sel > 0 ? stages[sel - 1]!.users : null;
  const next = stages[sel + 1]?.users ?? null;
  const copy = f.stages[sel]!;
  const ofPrev = prev ? (cur.users / prev) * 100 : 100;
  const ofTotal = (cur.users / top) * 100;
  const lost = next !== null ? cur.users - next : null;
  const lostPct = next !== null ? (lost! / cur.users) * 100 : null;

  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (sel + d + stages.length) % stages.length;
    setSel(n);
    tabs.current[n]?.focus();
  };

  return (
    <div className="funnel">
      <div className="funnel-list" role="tablist" aria-orientation="vertical" aria-label={f.listLabel} onKeyDown={onKey}>
        {stages.map((s, i) => {
          const prevN = i > 0 ? stages[i - 1]!.users : null;
          return (
            <div key={s.id} className="funnel-row" data-reveal="up" style={{ ["--i" as string]: i }}>
              {prevN && <span className="funnel-drop" aria-hidden="true">−{pf.format((1 - s.users / prevN) * 100)}%</span>}
              <button
                ref={(el) => { tabs.current[i] = el; }}
                type="button"
                role="tab"
                id={`funnel-tab-${i}`}
                aria-selected={sel === i}
                aria-controls="funnel-panel"
                tabIndex={sel === i ? 0 : -1}
                className="funnel-bar"
                data-active={sel === i}
                style={{ ["--w" as string]: widthOf(s.users) }}
                onClick={() => setSel(i)}
              >
                <span className="funnel-name">{f.stages[i]!.name}</span>
                <span className="funnel-num num">{nf.format(s.users)}</span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="funnel-panel card" role="tabpanel" id="funnel-panel" aria-labelledby={`funnel-tab-${sel}`} key={sel}>
        <div className="funnel-panel-head">
          <p className="eyebrow">{String(sel + 1).padStart(2, "0")} / {String(stages.length).padStart(2, "0")}</p>
          <h3 className="h3">{copy.name}</h3>
          <p className="small">{copy.what}</p>
        </div>

        <div className="funnel-stats">
          <div>
            <span className="funnel-big num">{nf.format(cur.users)}</span>
            <span className="small">{f.users}</span>
          </div>
          <div>
            <span className="funnel-mid num">{prev ? `${pf.format(ofPrev)}%` : "100%"}</span>
            <span className="small">{f.ofPrev}</span>
          </div>
          <div>
            <span className="funnel-mid num">{pf.format(ofTotal)}%</span>
            <span className="small">{f.ofTotal}</span>
          </div>
        </div>

        <div className="funnel-leak">
          {lost !== null && lostPct !== null ? (
            <>
              <div className="funnel-leak-bar" aria-hidden="true">
                <i style={{ width: `${100 - lostPct}%` }} />
              </div>
              <p><b className="num">{nf.format(lost)}</b> {f.users}, <b className="num">{pf.format(lostPct)}%</b>. {f.leave}.</p>
            </>
          ) : (
            <p>{f.leaveLast}</p>
          )}
        </div>

        <div className="funnel-lists">
          {([["reasons", copy.reasons, "search"], ["measure", copy.measure, "chart"], ["improve", copy.improve, "bolt"]] as const).map(([k, list, icon]) => (
            <div key={k}>
              <h4 className="funnel-h"><Icon name={icon} size={16} />{f[k]}</h4>
              <ul>
                {list.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
