"use client";

import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { moduleCatalog } from "@/data/modules";
import { OneKnightProvider, useOkState } from "./state";
import { ModuleCard } from "./ui/ModuleCard";
import { useFlash } from "./ui/kit";

function Inner() {
  const t = useDict().ok.modules;
  const s = useOkState();
  const [flash, show] = useFlash();
  const freeActive = !!s.subscription.freeUntil && s.subscription.freeUntil > Date.now();
  return (
    <div className="ok-market" data-accent={s.customization.accent}>
      {freeActive && <p className="ok-market-free"><span className="ok-pill" data-s="paid">{fmt(t.freeLeft, { n: s.subscription.freeModulesLimit - s.modules.filter((m) => m.free).length, max: s.subscription.freeModulesLimit })}</span></p>}
      <div className="ok-modules">
        {moduleCatalog.map((m) => (
          <ModuleCard key={m.id} def={m} onResult={(text, tone) => show(text, tone)} />
        ))}
      </div>
      {flash}
    </div>
  );
}

/** Same demo client as the playground: installing here adds the module to the dashboard above. */
export default function Marketplace() {
  return (
    <OneKnightProvider>
      <Inner />
    </OneKnightProvider>
  );
}
