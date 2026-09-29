"use client";

import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH, websiteTypes } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { useModal, type OrderOptions } from "@/components/global/ModalProvider";
import { Panel } from "@/features/oneknight/ui/kit";
import { MyLeads } from "./Leads";

/** Ordering work from inside ONEKNIGHT: the same brief as on the site, sent with the account's contacts. */
export function ServicesScreen() {
  const dict = useDict();
  const t = dict.app.servicesApp;
  const lang = useLang();
  const { openOrder } = useModal();
  const minSite = Math.min(...websiteTypes.map((w) => w.from));
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <p className="ok-muted">{t.lead}</p>
      <div className="ok-modules">
        {dict.services.cards.map((c) => {
          const service = (c.id === "websites" ? "website" : c.id) as NonNullable<OrderOptions["service"]>;
          return (
            <Panel key={c.id} className="ok-svc">
              <h5>{c.title}</h5>
              {service === "website" && <span className="ok-module-price num">{fmt(t.from, { price: formatUAH(minSite, lang) })}</span>}
              <p className="ok-muted">{c.text}</p>
              <ul className="ok-steps">{c.points.map((p) => <li key={p}>{p}</li>)}</ul>
              <button type="button" className="btn btn-sm btn-secondary" style={{ justifySelf: "start" }} onClick={() => openOrder("brief", { service })}>
                {t.order}<Icon name="arrow" size={15} />
              </button>
            </Panel>
          );
        })}
      </div>
      <MyLeads />
    </div>
  );
}
