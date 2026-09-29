"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useDict } from "@/i18n/provider";

type Props = {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  wide?: boolean;
};

/** Native <dialog>: focus trap, Esc and inert background come from the platform. */
export function Modal({ open, onClose, labelledBy, children, wide }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const dict = useDict();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      document.documentElement.classList.add("modal-open");
    }
    if (!open && d.open) d.close();
    return () => {
      document.documentElement.classList.remove("modal-open");
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={labelledBy}
      style={wide ? { maxWidth: "min(960px, calc(100vw - 1.5rem))" } : undefined}
      onClose={() => {
        document.documentElement.classList.remove("modal-open");
        onClose();
      }}
      onPointerDown={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="modal-panel">
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          style={{ position: "absolute", right: "0.75rem", top: "0.75rem", zIndex: 2 }}
          aria-label={dict.a11y.close}
          data-sound="close"
          onClick={() => ref.current?.close()}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 4l10 10M14 4L4 14" />
          </svg>
        </button>
        {children}
      </div>
    </dialog>
  );
}
