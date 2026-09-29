"use client";

import type { ReactNode } from "react";
import { useModal, type OrderStart } from "@/components/global/ModalProvider";
import { useDict } from "@/i18n/provider";
import { useSession } from "@/lib/session";

type Props = {
  className?: string;
  start?: OrderStart;
  children?: ReactNode;
  /** When signed in, this button opens ONEKNIGHT instead of the order modal. Default true. */
  authAware?: boolean;
  magnetic?: boolean;
};

/** The one primary conversion control. Signed out: order modal. Signed in: jumps to the ONEKNIGHT demo. */
export function OrderButton({ className = "btn btn-lg", start = "choose", children, authAware = true, magnetic = true }: Props) {
  const dict = useDict();
  const session = useSession();
  const { openOrder } = useModal();
  const signedIn = authAware && !!session;
  return (
    <button
      type="button"
      className={className}
      data-magnetic={magnetic ? "" : undefined}
      onClick={() => {
        if (signedIn) document.getElementById("playground")?.scrollIntoView({ behavior: "smooth" });
        else openOrder(start);
      }}
    >
      {children ?? (signedIn ? dict.nav.open : dict.nav.order)}
    </button>
  );
}
