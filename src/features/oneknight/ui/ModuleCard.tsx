"use client";

import { useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon, type IconName } from "@/components/ui/Icon";
import { playSound } from "@/lib/sound";
import { useClient, useOkState } from "../state";
import { useFormat } from "./kit";
import type { ModuleDef, ModuleId } from "../domain";

export const moduleIcon: Record<ModuleId, IconName> = {
  novaposhta: "truck", ukrposhta: "box", analytics: "chart", reviews: "star", olx: "cart", prom: "cart", rozetka: "cart", "ai-content": "bolt", zadarma: "phone",
};

/** One card, used in the playground Modules screen and in the public marketplace section. */
export function ModuleCard({ def, onResult }: { def: ModuleDef; onResult?: (text: string, tone: "ok" | "warn") => void }) {
  const t = useDict().ok.modules;
  const s = useOkState();
  const client = useClient();
  const f = useFormat();
  const [open, setOpen] = useState(false);
  const item = t.items[def.id];
  const installed = s.modules.find((m) => m.id === def.id);
  const soon = def.availability === "soon";
  const freeActive = !!s.subscription.freeUntil && s.subscription.freeUntil > Date.now();
  const freeLeft = s.subscription.freeModulesLimit - s.modules.filter((m) => m.free).length;
  const wouldBeFree = freeActive && freeLeft > 0;

  const install = () => {
    const r = client.installModule(def.id);
    if (r.ok) {
      playSound("install");
      onResult?.(t.done, "ok");
    } else {
      playSound("error");
      onResult?.(t.noMoney, "warn");
    }
  };

  return (
    <article className="ok-module" data-installed={!!installed} data-soon={soon}>
      <header>
        <span className="ok-module-ic"><Icon name={moduleIcon[def.id]} size={20} /></span>
        <div>
          <h5>{item.name}</h5>
          <span className="ok-module-price num">
            {installed?.free || (!installed && wouldBeFree && !soon) ? <><s>{fmt(t.perMonth, { price: f.money(def.price) })}</s> {t.free}</> : fmt(t.perMonth, { price: f.money(def.price) })}
          </span>
        </div>
        <span className="ok-module-status">{soon ? t.soon : installed ? t.installed : ""}</span>
      </header>
      <p>{item.desc}</p>
      {open && <p className="ok-module-demo"><Icon name="eye" size={14} />{item.demo}</p>}
      <footer>
        <button type="button" className="ok-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? t.less : t.more}</button>
        {soon ? (
          <button type="button" className="btn btn-sm btn-secondary" disabled>{t.soon}</button>
        ) : installed ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => client.uninstallModule(def.id)}>{t.remove}</button>
        ) : (
          <button type="button" className="btn btn-sm" data-sound="off" onClick={install}><Icon name="plus" size={16} />{t.install}</button>
        )}
      </footer>
    </article>
  );
}
