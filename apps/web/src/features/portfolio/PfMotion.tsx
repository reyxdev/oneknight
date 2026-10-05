"use client";

import { useEffect } from "react";
import { startMotionRuntime } from "@/lib/motion/runtime";
import { initPrefs, PREFS_KEY } from "@/lib/prefs";

/**
 * Motion for the portfolio: reveals and scroll scenes only (no guided scroll, no sounds — answer 197).
 * «Less motion» on the device turns every effect off unless the visitor chose otherwise on this site (answer 384).
 */
export function PfMotion() {
  useEffect(() => {
    initPrefs();
    let chosen = false;
    try {
      chosen = !!(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as { motion?: string }).motion;
    } catch {
      /* storage blocked: follow the device */
    }
    if (!chosen && window.matchMedia("(prefers-reduced-motion: reduce)").matches) document.documentElement.dataset.motion = "calm";
    return startMotionRuntime();
  }, []);
  return null;
}
