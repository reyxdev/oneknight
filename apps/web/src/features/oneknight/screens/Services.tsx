"use client";

import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { useModal } from "@/components/global/ModalProvider";
import { Panel } from "../ui/kit";

export function Services() {
  const dict = useDict();
  const t = dict.ok.services;
  const { openOrder } = useModal();
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <p className="ok-muted">{t.lead}</p>
      <div className="ok-modules">
        {dict.services.cards.map((c) => (
          <Panel key={c.id} className="ok-svc">
            <h5>{c.title}</h5>
            <p className="ok-muted">{c.text}</p>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => openOrder("choose")}>
              {t.order}<Icon name="arrow" size={15} />
            </button>
          </Panel>
        ))}
      </div>
    </div>
  );
}
