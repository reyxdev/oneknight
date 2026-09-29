"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { playSound } from "@/lib/sound";

type ToastItem = { id: number; text: string };
const ToastContext = createContext<(text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const id = useRef(0);
  const show = useCallback((text: string) => {
    const n = ++id.current;
    setItems((s) => [...s, { id: n, text }]);
    playSound("success");
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== n)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="ok-toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="ok-toast">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3.5 9.5l3.5 3.5 7.5-8" />
            </svg>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
