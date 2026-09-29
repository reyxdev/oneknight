"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { FlashContext } from "@/features/oneknight/ui/kit";

/**
 * Notices of the panel, bottom right: success disappears after 4 s, a problem stays until closed, and an action
 * that can be taken back shows «Скасувати» for 7 s. `commit` runs when the time is up (or the page closes), so
 * a deletion can wait until the person had the chance to change their mind.
 */
type Undo = { undo: () => void | Promise<void>; commit?: () => void | Promise<void> };
type Toast = { id: number; text: string; tone: "ok" | "warn"; undo?: Undo };
type Api = { show: (text: string, tone?: "ok" | "warn") => void; undo: (text: string, u: Undo) => void };

const OK_MS = 4000;
export const UNDO_MS = 7000;
const Ctx = createContext<Api | null>(null);

export function useToast(): Api {
  const api = useContext(Ctx);
  if (!api) throw new Error("useToast outside <Toasts>");
  return api;
}

export function Toasts({ children }: { children: ReactNode }) {
  const t = useDict().app.toast;
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // Commits waiting for the undo time to pass; run at once if the page is closed meanwhile.
  const pending = useRef(new Map<number, Undo>());

  const drop = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setList((l) => l.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = ++seq.current;
      setList((l) => [...l, { ...toast, id }]);
      if (toast.undo) {
        pending.current.set(id, toast.undo);
        timers.current.set(
          id,
          setTimeout(() => {
            const u = pending.current.get(id);
            pending.current.delete(id);
            void u?.commit?.();
            drop(id);
          }, UNDO_MS),
        );
      } else if (toast.tone === "ok") timers.current.set(id, setTimeout(() => drop(id), OK_MS));
      return id;
    },
    [drop],
  );

  useEffect(() => {
    const flush = () => {
      for (const u of pending.current.values()) void u.commit?.();
      pending.current.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const api = useMemo<Api>(() => ({ show: (text, tone = "ok") => void push({ text, tone }), undo: (text, u) => void push({ text, tone: "ok", undo: u }) }), [push]);
  const cancel = async (x: Toast) => {
    pending.current.delete(x.id);
    drop(x.id);
    await x.undo?.undo();
  };

  return (
    <Ctx.Provider value={api}>
      <FlashContext.Provider value={api.show}>
        {children}
        <div className="app-toasts" role="status" aria-live="polite">
          {/* Up to 3 at once; hidden older ones still run out their time. */}
          {list.slice(-3).map((x) => (
            <div key={x.id} className="app-toast" data-tone={x.tone} data-undo={!!x.undo}>
              <Icon name={x.tone === "ok" ? "check" : "bolt"} size={16} />
              <span className="ok-grow">{x.text}</span>
              {x.undo && <button type="button" className="app-toast-undo" onClick={() => cancel(x)}>{t.undo}</button>}
              {!x.undo && x.tone !== "ok" && <button type="button" className="app-toast-close" aria-label={t.close} onClick={() => drop(x.id)}><Icon name="close" size={14} /></button>}
              {x.undo && <i className="app-toast-time" style={{ animationDuration: `${UNDO_MS}ms` }} />}
            </div>
          ))}
        </div>
      </FlashContext.Provider>
    </Ctx.Provider>
  );
}
