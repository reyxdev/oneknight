"use client";

import { useEffect, useMemo, useState } from "react";
import { HONEY_DEFAULTS, type HoneyController, type HoneyParams } from "./engine";
import { HoneyWord } from "./HoneyWord";

type Slider = { key: keyof HoneyParams; label: string; min: number; max: number; step: number };
const SLIDERS: Slider[] = [
  { key: "level", label: "Рівень меду", min: 0.3, max: 0.95, step: 0.01 },
  { key: "viscosity", label: "Тягучість (1 вода … 10 смола)", min: 1, max: 10, step: 1 },
  { key: "transparency", label: "Прозорість меду", min: 1, max: 10, step: 1 },
  { key: "slosh", label: "Сила хлюпання", min: 1, max: 10, step: 1 },
  { key: "smoke", label: "Димчасте скло", min: 0, max: 1, step: 0.05 },
  { key: "light", label: "Звідки світло, °", min: 30, max: 170, step: 5 },
  { key: "caustics", label: "Зайчики на папері", min: 0, max: 1.5, step: 0.05 },
  { key: "bubbles", label: "Бульбашок у літері", min: 0, max: 6, step: 1 },
  { key: "dripEvery", label: "Крапля раз на, с", min: 3, max: 30, step: 1 },
  { key: "beeEvery", label: "Бджола раз на, с", min: 10, max: 120, step: 5 },
];

/**
 * The honey sandbox (answer 49): the owner moves the sliders until the honey looks right, then copies the numbers
 * here into the chat. Depth rebuilds the glass, so it has its own «Перебудувати» button.
 */
export function HoneyLab() {
  const [p, setP] = useState<HoneyParams>(HONEY_DEFAULTS);
  const [depth, setDepth] = useState(HONEY_DEFAULTS.depth);
  const [ctl, setCtl] = useState<HoneyController | null>(null);
  const [copied, setCopied] = useState(false);
  const [key, setKey] = useState(0);
  // ?still=1: the honey already poured and resting (for snapshots)
  const [still, setStill] = useState(false);
  useEffect(() => setStill(new URLSearchParams(window.location.search).has("still")), []);
  const live = useMemo(() => ({ ...p }), [p]);
  const set = (k: keyof HoneyParams, v: number | boolean) => setP((x) => ({ ...x, [k]: v }));
  return (
    <div className="pf-lab">
      <div className="pf-lab-stage">
        <HoneyWord key={`${key}-${still}`} params={{ ...live, depth }} onController={setCtl} poster={false} still={still} />
        <p className="pf-hand pf-honey-note">торкніться — хлюпне</p>
      </div>
      <div className="pf-lab-panel">
        <div className="pf-lab-actions">
          <button type="button" className="pf-btn pf-btn-amber pf-btn-sm" onClick={() => ctl?.pour()}>Налити знову</button>
          <button type="button" className="pf-btn pf-btn-sm" onClick={() => ctl?.splash()}>Бульк</button>
          <button type="button" className="pf-btn pf-btn-sm" onClick={async () => { const ok = await ctl?.requestTilt(); alert(ok ? "Нахиліть телефон" : "Телефон не дав доступу до датчика руху"); }}>Нахил телефона</button>
          <button
            type="button"
            className="pf-btn pf-btn-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(JSON.stringify({ ...p, depth }));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                /* the numbers are visible on screen anyway */
              }
            }}
          >
            {copied ? "Скопійовано" : "Скопіювати налаштування"}
          </button>
        </div>
        <div className="pf-lab-sliders">
          {SLIDERS.map((s) => (
            <label key={s.key}>
              <span>{s.label}: <b>{String(p[s.key])}</b></span>
              <input type="range" min={s.min} max={s.max} step={s.step} value={Number(p[s.key])} onChange={(e) => set(s.key, Number(e.target.value))} />
            </label>
          ))}
          <label>
            <span>Глибина літер: <b>{depth}</b></span>
            <input type="range" min={1} max={10} step={1} value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
          </label>
          <button type="button" className="pf-btn pf-btn-sm" onClick={() => setKey((k) => k + 1)}>Перебудувати з новою глибиною</button>
          <label className="pf-lab-check"><input type="checkbox" checked={p.lids} onChange={(e) => set("lids", e.target.checked)} /> Кришечки з тканиною</label>
          <label className="pf-lab-check"><input type="checkbox" checked={p.bee} onChange={(e) => set("bee", e.target.checked)} /> Бджола</label>
        </div>
        <pre className="pf-lab-json">{JSON.stringify({ ...p, depth })}</pre>
      </div>
    </div>
  );
}
