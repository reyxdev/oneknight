"use client";

import { useDict, useLang } from "@/i18n/provider";
import { withLang } from "@/i18n";
import { useSignedIn } from "@/lib/session";
import { useModal } from "@/components/global/ModalProvider";
import { Icon } from "@/components/ui/Icon";

export function FinalChoices() {
  const dict = useDict();
  const d = dict.order;
  const lang = useLang();
  const session = useSignedIn();
  const { openOrder } = useModal();
  return (
    <div className="final-choices">
      <a className="final-choice final-choice-main" data-cursor="link" href={withLang(lang, session ? "/app/" : "/app/?start=register")}>
        <Icon name="shield" size={24} />
        <b>{session ? dict.nav.open : d.viaOk}</b>
        <span>{d.viaOkText}</span>
      </a>
      <button type="button" className="final-choice" data-cursor="link" onClick={() => openOrder("call")}>
        <Icon name="phone" size={24} />
        <b>{d.call}</b>
        <span>{d.callText}</span>
      </button>
    </div>
  );
}
