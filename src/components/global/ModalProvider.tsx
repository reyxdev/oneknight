"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { playSound } from "@/lib/sound";

export type OrderStart = "choose" | "login" | "register" | "call" | "brief";
export type OrderOptions = { siteType?: string };

type Ctx = {
  openOrder: (start?: OrderStart, opts?: OrderOptions) => void;
  close: () => void;
  state: { open: boolean; start: OrderStart; mounted: boolean; opts: OrderOptions; nonce: number };
};

const ModalContext = createContext<Ctx | null>(null);
const OrderModal = dynamic(() => import("@/features/cta/OrderModal").then((m) => m.OrderModal), { ssr: false });

export function ModalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Ctx["state"]>({ open: false, start: "choose", mounted: false, opts: {}, nonce: 0 });
  const openOrder = useCallback((start: OrderStart = "choose", opts: OrderOptions = {}) => {
    playSound("open");
    setState((s) => ({ open: true, start, mounted: true, opts, nonce: s.nonce + 1 }));
  }, []);
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  const value = useMemo(() => ({ openOrder, close, state }), [openOrder, close, state]);
  return (
    <ModalContext.Provider value={value}>
      {children}
      {state.mounted && <OrderModal />}
    </ModalContext.Provider>
  );
}

export function useModal(): Ctx {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal outside ModalProvider");
  return ctx;
}
