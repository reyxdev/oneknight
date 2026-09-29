"use client";

import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { moduleCatalog } from "@/data/modules";
import { useOkState } from "../state";
import { useFlash } from "../ui/kit";
import { ModuleCard } from "../ui/ModuleCard";

export function Modules() {
  const t = useDict().ok.modules;
  const s = useOkState();
  const [flash, show] = useFlash();
  const freeActive = !!s.subscription.freeUntil && s.subscription.freeUntil > Date.now();
  return (
    <div className="ok-screen">
      <div className="ok-h">
        <h3>{t.title}</h3>
        {freeActive && <span className="ok-pill" data-s="paid">{fmt(t.freeLeft, { n: s.subscription.freeModulesLimit - s.modules.filter((m) => m.free).length, max: s.subscription.freeModulesLimit })}</span>}
      </div>
      <p className="ok-muted">{t.lead}</p>
      <div className="ok-modules">
        {moduleCatalog.map((m) => (
          <ModuleCard key={m.id} def={m} onResult={show} />
        ))}
      </div>
      {flash}
    </div>
  );
}
