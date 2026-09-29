"use client";

import { useEffect, useId, useRef, useState } from "react";
import { setPref, usePrefs } from "@/lib/prefs";
import { playSound, unlockSound } from "@/lib/sound";
import { useDict } from "@/i18n/provider";

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; t: string }[]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-labelledby={id} className="grid gap-2">
      <div id={id} className="text-sm font-semibold">{label}</div>
      <div className="grid gap-1 rounded-[12px] bg-surface-2 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            data-sound="toggle"
            onClick={() => onChange(o.v)}
            className="min-h-10 rounded-[9px] px-2 text-sm font-medium transition-colors duration-150 aria-checked:bg-surface aria-checked:shadow-sm"
          >
            {o.t}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PrefsMenu() {
  const dict = useDict();
  const p = usePrefs();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        aria-label={dict.prefs.open}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <path d="M3 6h9M16 6h1M3 14h1M8 14h9" />
          <circle cx="14" cy="6" r="2" />
          <circle cx="6" cy="14" r="2" />
        </svg>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-[calc(100%+0.5rem)] z-[70] grid w-[min(20rem,90vw)] gap-4 rounded-[20px] border border-line bg-surface p-4 shadow-lg"
      >
        <div className="text-base font-bold">{dict.prefs.title}</div>
        <Seg
          label={dict.prefs.theme}
          value={p.theme}
          onChange={(v) => setPref("theme", v)}
          options={[
            { v: "system", t: dict.prefs.themeSystem },
            { v: "light", t: dict.prefs.themeLight },
            { v: "dark", t: dict.prefs.themeDark },
          ]}
        />
        <Seg
          label={dict.prefs.motion}
          value={p.motion}
          onChange={(v) => setPref("motion", v)}
          options={[
            { v: "full", t: dict.prefs.motionFull },
            { v: "calm", t: dict.prefs.motionCalm },
          ]}
        />
        <Seg
          label={dict.prefs.sound}
          value={p.sound ? "on" : "off"}
          onChange={(v) => {
            if (v === "on") {
              unlockSound();
              setPref("sound", true);
              playSound("toggle");
            } else setPref("sound", false);
          }}
          options={[
            { v: "off", t: dict.prefs.soundOff },
            { v: "on", t: dict.prefs.soundOn },
          ]}
        />
      </div>
    </div>
  );
}
