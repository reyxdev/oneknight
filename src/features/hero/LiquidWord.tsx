"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import type { LiquidController } from "./liquid/engine";

type Props = { parts: readonly [string, string] };

/**
 * ONEKNIGHT as liquid. Server renders the CSS fallback (real text, no loading state, no layout shift).
 * When WebGL2 is available the canvas fades in over it. The engine is imported on demand.
 */
export function LiquidWord({ parts }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ctl = useRef<LiquidController | null>(null);
  const [gl, setGl] = useState<"idle" | "ready" | "off">("idle");
  const { motion } = usePrefs();
  const text = parts.join("");

  useEffect(() => {
    let dead = false;
    const mq = window.matchMedia("(max-width: 767px)");
    const family = () => getComputedStyle(document.documentElement).getPropertyValue("--font-geologica");
    const scene = wrap.current?.closest<HTMLElement>("[data-scene]") ?? null;
    let mo: MutationObserver | null = null;
    const onMq = () => ctl.current?.setLayout(mq.matches ? "two" : "one");

    (async () => {
      try {
        await document.fonts.load(`900 100px ${family()}`, text);
      } catch {
        /* fall through: canvas draws with the fallback face if the font failed */
      }
      if (dead || !canvas.current) return;
      const { createLiquid } = await import("./liquid/engine");
      if (dead || !canvas.current) return;
      const c = createLiquid({
        canvas: canvas.current,
        lines: (l) => (l === "one" ? [text] : [...parts]),
        family,
        progress: () => Number.parseFloat(scene?.style.getPropertyValue("--p") || "0") || 0,
        isDarkPage: () => document.documentElement.dataset.theme === "dark",
        onReady: () => setGl("ready"),
        onFail: () => setGl("off"),
      });
      if (!c) {
        setGl("off");
        return;
      }
      ctl.current = c;
      c.setLayout(mq.matches ? "two" : "one");
      c.setCalm(document.documentElement.dataset.motion === "calm");
      mq.addEventListener("change", onMq);
      mo = new MutationObserver(() => c.refreshTheme());
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    })();

    return () => {
      dead = true;
      mq.removeEventListener("change", onMq);
      mo?.disconnect();
      ctl.current?.destroy();
      ctl.current = null;
    };
  }, [parts, text]);

  useEffect(() => {
    ctl.current?.setCalm(motion === "calm");
  }, [motion]);

  return (
    <div ref={wrap} className="liquid" data-gl={gl}>
      <span className="liquid-fallback display" aria-hidden="true">
        {parts.map((p, i) => (
          <span key={p + i}>{p}</span>
        ))}
      </span>
      <canvas ref={canvas} className="liquid-canvas" aria-hidden="true" />
    </div>
  );
}
