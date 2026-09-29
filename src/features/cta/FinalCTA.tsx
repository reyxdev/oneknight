"use client";

import { useDict } from "@/i18n/provider";
import { useSession } from "@/lib/session";
import { useModal } from "@/components/global/ModalProvider";
import { Icon } from "@/components/ui/Icon";

export function FinalChoices() {
  const dict = useDict();
  const d = dict.order;
  const session = useSession();
  const { openOrder } = useModal();
  return (
    <div className="final-choices">
      <button
        type="button"
        className="final-choice final-choice-main"
        data-cursor="link"
        onClick={() => (session ? document.getElementById("playground")?.scrollIntoView({ behavior: "smooth" }) : openOrder(session ? "brief" : "register"))}
      >
        <Icon name="shield" size={24} />
        <b>{session ? dict.nav.open : d.viaOk}</b>
        <span>{d.viaOkText}</span>
      </button>
      <button type="button" className="final-choice" data-cursor="link" onClick={() => openOrder("call")}>
        <Icon name="phone" size={24} />
        <b>{d.call}</b>
        <span>{d.callText}</span>
      </button>
    </div>
  );
}
