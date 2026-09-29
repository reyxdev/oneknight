"use client";

import { useEffect, useRef } from "react";
import { tick } from "@/lib/motion/ticker";
import { makeSpring, stepSpring } from "@/lib/motion/spring";

/**
 * Custom cursor. Fine pointers only. One delegated listener, DOM writes in the shared ticker.
 * Declare states in markup:
 *   data-cursor="view|play|drag|case|preview|link|text|hidden"   (label shown for view/play/drag/case)
 *   data-cursor-label="Custom"   overrides the label text
 *   data-cursor-src="/img.webp"  thumbnail for data-cursor="preview"
 * Anchors and buttons get the "link" state automatically.
 */
const LABELS: Record<string, string> = { view: "VIEW", play: "PLAY", drag: "DRAG", case: "CASE" };
const AUTO = "a[href], button, [role='button'], summary, label[for], select, [data-cursor='link']";
const TEXT = "input:not([type='checkbox']):not([type='radio']):not([type='range']), textarea";

export function Cursor() {
  const rootRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    if (!mq.matches) return;
    const root = rootRef.current!;
    const html = document.documentElement;
    html.classList.add("has-cursor");

    const dx = makeSpring(-100);
    const dy = makeSpring(-100);
    const rx = makeSpring(-100);
    const ry = makeSpring(-100);
    let visible = false;
    let first = true;

    const setState = (state: string, label?: string, src?: string) => {
      if (root.dataset.state !== state) root.dataset.state = state;
      const showLabel = !!label;
      root.dataset.label = String(showLabel);
      if (labelRef.current && labelRef.current.textContent !== (label ?? "")) labelRef.current.textContent = label ?? "";
      if (thumbRef.current) thumbRef.current.style.backgroundImage = src ? `url(${src})` : "";
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      dx.target = rx.target = e.clientX;
      dy.target = ry.target = e.clientY;
      if (first) {
        dx.x = rx.x = e.clientX;
        dy.x = ry.x = e.clientY;
        first = false;
      }
      if (!visible) {
        visible = true;
        root.dataset.visible = "true";
      }
    };
    const onOver = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest) return;
      const tagged = t.closest<HTMLElement>("[data-cursor]");
      const kind = tagged?.dataset.cursor;
      if (kind && kind !== "link") {
        if (kind === "hidden") return setState("hidden");
        if (kind === "text") return setState("text");
        if (kind === "preview") return setState("preview", undefined, tagged!.dataset.cursorSrc);
        return setState("interactive", tagged!.dataset.cursorLabel ?? LABELS[kind]);
      }
      if (t.closest(TEXT)) return setState("text");
      if (t.closest(AUTO)) return setState("link");
      setState("default");
    };
    const onDown = () => (root.dataset.pressed = "true");
    const onUp = () => (root.dataset.pressed = "false");
    const onLeave = () => {
      visible = false;
      root.dataset.visible = "false";
    };

    const stop = tick((dt) => {
      const x = stepSpring(dx, dt, 28);
      const y = stepSpring(dy, dt, 28);
      const x2 = stepSpring(rx, dt, 95);
      const y2 = stepSpring(ry, dt, 95);
      if (dotRef.current) dotRef.current.style.transform = `translate3d(${x}px,${y}px,0)`;
      const rt = `translate3d(${x2}px,${y2}px,0)`;
      if (ringRef.current) ringRef.current.style.transform = rt;
      if (labelRef.current) labelRef.current.style.transform = `translate3d(${x2}px,${y2}px,0) translate(-50%,-50%)`;
      if (thumbRef.current) thumbRef.current.style.transform = `translate3d(${x2}px,${y2}px,0)`;
    });

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerover", onOver, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      stop();
      html.classList.remove("has-cursor");
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerover", onOver);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={rootRef} className="ok-cursor" data-state="default" data-visible="false" aria-hidden="true">
      <div ref={thumbRef} className="ok-cursor-thumb" />
      <div ref={ringRef} className="ok-cursor-ring" />
      <div ref={dotRef} className="ok-cursor-dot" />
      <span ref={labelRef} className="ok-cursor-label" />
    </div>
  );
}
