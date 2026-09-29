"use client";

import { useEffect, useState } from "react";
import { getPrefs, setPref } from "@/lib/prefs";
import { useDict } from "@/i18n/provider";

/** Animations are not switched off automatically. If the OS asks for less motion, we ask once. */
export function ReducedMotionHint() {
  const t = useDict().prefs;
  const [show, setShow] = useState(false);
  useEffect(() => {
    const p = getPrefs();
    if (!p.hintSeen && p.motion === "full" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = setTimeout(() => setShow(true), 1200);
      return () => clearTimeout(id);
    }
  }, []);
  if (!show) return null;
  const answer = (calm: boolean) => {
    if (calm) setPref("motion", "calm");
    setPref("hintSeen", true);
    setShow(false);
  };
  return (
    <div className="ok-hint" role="dialog" aria-live="polite" aria-label={t.motion}>
      <p>{t.reducedHint}</p>
      <div>
        <button type="button" className="btn btn-sm" onClick={() => answer(true)}>{t.reducedYes}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => answer(false)}>{t.reducedNo}</button>
      </div>
    </div>
  );
}
