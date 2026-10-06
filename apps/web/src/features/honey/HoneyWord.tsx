"use client";

import { useEffect, useRef, useState } from "react";
import type { HoneyController, HoneyParams } from "./engine";

/** Weak phones (few cores, little memory, «Економія трафіку») get the still picture (answers 37, 39). */
function weakDevice() {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || !!nav.connection?.saveData;
}

/**
 * ONEKNIGHT in glass jars of honey. A still picture shows first; the 3D engine (three.js) is loaded only when the
 * word comes near the screen and then «comes alive» over it (answers 42, 43). It pauses off screen (45). With «less
 * motion» or on weak phones the still picture stays (39, 40). Tapping it sloshes the honey and, on iPhone, asks for
 * the motion sensor so the honey keeps the horizon (13, 14).
 */
export function HoneyWord({ params, onController, poster = true, still = false }: { params?: Partial<HoneyParams>; onController?: (c: HoneyController | null) => void; poster?: boolean; still?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ctl = useRef<HoneyController | null>(null);
  const [state, setState] = useState<"idle" | "ready" | "off">("idle");
  const [two, setTwo] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setTwo(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el || !canvas.current) return;
    const calm = document.documentElement.dataset.motion === "calm" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm || weakDevice()) {
      setState("off");
      return;
    }
    let dead = false;
    let started = false;
    const start = async () => {
      if (started) return;
      started = true;
      const { createHoneyWord } = await import("./engine");
      if (dead || !canvas.current) return;
      const c = createHoneyWord({
        canvas: canvas.current,
        lines: two ? ["ONE", "KNIGHT"] : ["ONEKNIGHT"],
        params,
        still,
        onReady: () => !dead && setState("ready"),
        onFail: () => !dead && setState("off"),
      });
      if (!c) return setState("off");
      ctl.current = c;
      onController?.(c);
    };
    const near = new IntersectionObserver(([e]) => e?.isIntersecting && void start(), { rootMargin: "600px 0px" });
    const seen = new IntersectionObserver(([e]) => ctl.current?.setVisible(!!e?.isIntersecting));
    near.observe(el);
    seen.observe(el);
    const ro = new ResizeObserver(() => ctl.current?.resize());
    ro.observe(el);
    return () => {
      dead = true;
      near.disconnect();
      seen.disconnect();
      ro.disconnect();
      ctl.current?.destroy();
      ctl.current = null;
      onController?.(null);
    };
    // params are applied through the controller; the word is created again only for one / two lines
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [two]);

  useEffect(() => {
    if (params) ctl.current?.setParams(params);
  }, [params]);

  return (
    <div ref={wrap} className="pf-honey" data-state={state} data-lines={two ? 2 : 1} onPointerDown={() => void ctl.current?.requestTilt()}>
      {poster && <img className="pf-honey-poster" src={two ? "/portfolio/honey/oneknight-2.webp" : "/portfolio/honey/oneknight-1.webp"} alt="" aria-hidden="true" decoding="async" />}
      <canvas ref={canvas} className="pf-honey-canvas" aria-label="ONEKNIGHT" role="img" />
    </div>
  );
}
