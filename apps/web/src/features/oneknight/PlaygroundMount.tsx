"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { OneKnightProvider } from "./state";

const Playground = dynamic(() => import("./Playground"), { ssr: false, loading: () => <div className="ok-frame ok-frame-loading" aria-hidden="true" /> });

/** Loads the dashboard code only when the visitor gets close to it. */
export function PlaygroundMount() {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting) {
        setShow(true);
        io.disconnect();
      }
    }, { rootMargin: "120% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref}>{show ? <OneKnightProvider><Playground /></OneKnightProvider> : <div className="ok-frame ok-frame-loading" aria-hidden="true" />}</div>;
}
