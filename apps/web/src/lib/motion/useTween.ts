"use client";

import { useEffect, useRef, useState } from "react";
import { tick } from "./ticker";
import { clamp, easeOutExpo } from "./spring";

/** Animates a displayed number toward `value`. Instant in calm mode. */
export function useTween(value: number, ms = 900): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const cur = useRef(value);
  useEffect(() => {
    if (document.documentElement.dataset.motion === "calm") {
      cur.current = value;
      setShown(value);
      return;
    }
    from.current = cur.current;
    const start = performance.now();
    const stop = tick((_, now) => {
      const t = clamp((now - start) / ms);
      cur.current = from.current + (value - from.current) * easeOutExpo(t);
      setShown(cur.current);
      if (t >= 1) stop();
    });
    return stop;
  }, [value, ms]);
  return Math.round(shown);
}
