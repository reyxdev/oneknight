"use client";

import { useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { oneknightPricing } from "@/data/pricing";
import { moduleCatalog } from "@/data/modules";
import { Icon } from "@/components/ui/Icon";
import { useModal } from "@/components/global/ModalProvider";
import { useClient, useOkState } from "../state";
import { Panel, useFormat } from "../ui/kit";

export function Account() {
  const dict = useDict();
  const t = dict.ok.account;
  const s = useOkState();
  const client = useClient();
  const { openOrder } = useModal();
  const f = useFormat();
  const [topUp, setTopUp] = useState(false);
  const sub = s.subscription;
  const free = !!sub.freeUntil && sub.freeUntil > Date.now();
  const paidModules = s.modules.filter((m) => !m.free);
  const modulesCost = paidModules.reduce((a, m) => a + (moduleCatalog.find((d) => d.id === m.id)?.price ?? 0), 0);
  const allModulesAfter = s.modules.reduce((a, m) => a + (moduleCatalog.find((d) => d.id === m.id)?.price ?? 0), 0);

  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      {sub.graceUntil && (
        <div className="ok-alert" role="alert">
          <Icon name="bolt" size={18} />
          <div>
            <b>{t.grace}</b>
            <p>{fmt(t.graceText, { date: f.date(sub.graceUntil) })}</p>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => setTopUp(true)}>{t.topUp}</button>
        </div>
      )}
      <div className="ok-grid-2">
        <Panel title={t.balance} action={<button type="button" className="btn btn-sm" onClick={() => setTopUp((v) => !v)} aria-expanded={topUp}>{t.topUp}</button>}>
          <p className="ok-big num" data-low={s.balance < oneknightPricing.perMonth}>{f.money(s.balance)}</p>
          {topUp && (
            <div className="ok-topup">
              <h5>{t.topUpTitle}</h5>
              <p className="ok-muted">{t.topUpLead}</p>
              <dl>
                <div><dt>{t.recipient}</dt><dd className="ok-todo">{t.pending}</dd></div>
                <div><dt>{t.iban}</dt><dd className="ok-todo">{t.pending}</dd></div>
                <div><dt>{t.purpose}</dt><dd>{fmt(t.purposeValue, { id: "DEMO-0001" })}</dd></div>
              </dl>
            </div>
          )}
        </Panel>
        <Panel title={t.subscription}>
          <ul className="ok-list">
            <li>
              <span className="ok-grow">ONEKNIGHT</span>
              {free ? <span className="ok-pill" data-s="done">{fmt(t.freeUntil, { date: f.date(sub.freeUntil!) })}</span> : sub.graceUntil ? <span className="ok-pill" data-s="cancelled">{t.grace}</span> : <span className="ok-pill" data-s="done">{t.paid}</span>}
              <b className="num">{free ? f.money(0) : f.money(sub.price)}</b>
            </li>
            <li><span className="ok-grow">{t.modulesCost} ({s.modules.length})</span><b className="num">{f.money(modulesCost)}</b></li>
            <li><b className="ok-grow">{t.total}</b><b className="num">{f.money((free ? 0 : sub.price) + modulesCost)}</b></li>
          </ul>
          {free && <p className="ok-muted">{t.after}: ONEKNIGHT {f.money(sub.price)} + {t.modulesCost.toLowerCase()} {f.money(allModulesAfter)}</p>}
          <p className="ok-muted">{fmt(t.nextCharge, { date: f.date(sub.nextChargeAt) })}</p>
        </Panel>
      </div>
      <Panel title={t.support}>
        <p>{fmt(t.supportText, { h: oneknightPricing.supportResponseHours })}</p>
        <div className="ok-actions">
          <b className="num">{fmt(dict.common.perMonth, { price: f.money(oneknightPricing.supportPerMonth) })}</b>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => openOrder("call")}>{t.supportCta}</button>
        </div>
      </Panel>
      {client.simulateLowBalance && (
        <Panel title={t.scenario} className="ok-scenario">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => client.simulateLowBalance!(!sub.graceUntil)}>
            {sub.graceUntil ? t.scenarioOk : t.scenarioLow}
          </button>
        </Panel>
      )}
    </div>
  );
}
