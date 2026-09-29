"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { OneKnightClient } from "./client";
import type { OkState } from "@oneknight/domain";
import { createDemoClient } from "./demo/client";
import { useLang } from "@/i18n/provider";

/** One client per page, shared by the playground and the module marketplace. Swap here for the live API client. */
let shared: { lang: string; client: OneKnightClient } | null = null;
function getClient(lang: "uk" | "en") {
  if (!shared || shared.lang !== lang) shared = { lang, client: createDemoClient(lang) };
  return shared.client;
}

const Ctx = createContext<OneKnightClient | null>(null);

export function OneKnightProvider({ children }: { children: ReactNode }) {
  const lang = useLang();
  return <Ctx.Provider value={getClient(lang)}>{children}</Ctx.Provider>;
}

export function useClient(): OneKnightClient {
  const c = useContext(Ctx);
  if (!c) throw new Error("useClient outside OneKnightProvider");
  return c;
}

/** Whole snapshot. The reference changes only when the state changes, so derive inside the component. */
export function useOkState(): OkState {
  const c = useClient();
  return useSyncExternalStore(c.subscribe, c.getState, c.getState);
}

/** Simulated live events run only while the demo is on screen. */
export function useLiveWhileVisible(ref: React.RefObject<HTMLElement | null>) {
  const c = useClient();
  useEffect(() => {
    const el = ref.current;
    if (!el || !c.setLive) return;
    const io = new IntersectionObserver((e) => c.setLive!(e[0]?.isIntersecting ?? false), { threshold: 0.25 });
    io.observe(el);
    return () => {
      io.disconnect();
      c.setLive!(false);
    };
  }, [c, ref]);
}
