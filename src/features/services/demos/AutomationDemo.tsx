"use client";

import { useState } from "react";
import { useDict } from "@/i18n/provider";
import { Toggle } from "@/components/ui/Toggle";
import { Icon } from "@/components/ui/Icon";

const MANUAL = [
  { x: 24, y: 14, r: -5 },
  { x: 70, y: 34, r: 4 },
  { x: 30, y: 60, r: 6 },
  { x: 72, y: 82, r: -4 },
];
const AUTO = [16, 38, 60, 82];

export function AutomationDemo() {
  const t = useDict().services.automation;
  const [auto, setAuto] = useState(false);
  return (
    <div className="demo demo-auto" data-auto={auto}>
      <Toggle checked={auto} onChange={setAuto} label={auto ? t.label : t.manual} />
      <div className="auto-stage">
        <span className="auto-line" aria-hidden="true"><i /></span>
        {t.steps.map((s, i) => {
          const m = MANUAL[i]!;
          return (
            <div
              key={s}
              className="auto-card"
              style={{
                ["--x" as string]: `${auto ? 50 : m.x}%`,
                ["--y" as string]: `${auto ? AUTO[i]! : m.y}%`,
                ["--r" as string]: `${auto ? 0 : m.r}deg`,
                ["--d" as string]: `${i * 90}ms`,
              }}
            >
              <span className="auto-num">{i + 1}</span>
              {s}
              {auto && <Icon name="bolt" size={14} className="auto-bolt" />}
            </div>
          );
        })}
      </div>
      <p className="auto-count" aria-live="polite">{auto ? t.autoCount : t.manualCount}</p>
    </div>
  );
}
