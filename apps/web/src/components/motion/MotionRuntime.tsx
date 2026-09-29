"use client";

import { useEffect } from "react";
import { startMotionRuntime } from "@/lib/motion/runtime";
import { startGuidedScroll } from "@/lib/motion/guided-scroll";
import { initPrefs, getPrefs } from "@/lib/prefs";
import { playSound, unlockSound } from "@/lib/sound";

const PRESS = "button, a[href], [role='button'], summary, [data-sound]";

/** Mounts the shared runtime once: prefs, motion attributes, delegated press sound. Renders nothing. */
export function MotionRuntime() {
  useEffect(() => {
    initPrefs();
    const stop = startMotionRuntime();
    const stopGuided = startGuidedScroll();
    const onDown = (e: PointerEvent) => {
      if (!getPrefs().sound) return;
      unlockSound();
      const el = (e.target as Element | null)?.closest<HTMLElement>(PRESS);
      if (!el || el.matches("[disabled], [aria-disabled='true'], [data-sound='off']")) return;
      const named = el.dataset.sound as Parameters<typeof playSound>[0] | undefined;
      playSound(named ?? "click");
    };
    document.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown, { capture: true });
      stop();
      stopGuided();
    };
  }, []);
  return null;
}
