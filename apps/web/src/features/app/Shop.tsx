"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { api } from "@/lib/api";
import { readImage } from "@/lib/files";
import { playSound } from "@/lib/sound";
import { Empty, Panel, useFlash } from "@/features/oneknight/ui/kit";
import { useSites, type SiteInfo } from "./SiteScreen";
import { useToast } from "./Toasts";
import { Table, useEscClose, type Col, type Sort } from "./Table";

type Product = { id: string; name: string; description: string; price: number; stock: number | null; active: boolean; photo: string | null };
type Draft = { name: string; description: string; price: string; stock: string; active: boolean; photo: { name: string; data: string } | null; photoUrl: string | null };
const empty: Draft = { name: "", description: "", price: "", stock: "", active: true, photo: null, photoUrl: null };

export function useSitePicker() {
  const { sites } = useSites();
  const [sel, setSel] = useState(0);
  const site = sites?.[Math.min(sel, (sites?.length ?? 1) - 1)] ?? null;
  const picker =
    sites && sites.length > 1 ? (
      <div className="ok-chips">
        {sites.map((s, i) => (
          <button key={s.id} type="button" className="ok-chip" aria-pressed={i === sel} onClick={() => setSel(i)}>{s.domain}</button>
        ))}
      </div>
    ) : null;
  return { sites, site, picker };
}

/** Site key and a copy-ready example, shown on the Site screen. */
export function SiteApiPanel({ site, onRotated }: { site: SiteInfo & { publicKey?: string }; onRotated: () => void }) {
  const t = useDict().app.api;
  const [flash, show] = useFlash();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://oneknight.pro";
  const sample = `fetch("${origin}/api/public/products", { headers: { "x-site-key": "${site.publicKey}" } })\n  .then((r) => r.json())`;
  return (
    <Panel title={t.title}>
      <p className="ok-muted">{t.lead}</p>
      <div className="ok-kv"><div><span>{t.key}</span><code className="app-key">{site.publicKey}</code></div></div>
      <details>
        <summary className="ok-link">{t.example}</summary>
        <pre className="app-code-block">{sample}</pre>
      </details>
      <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: "start" }} onClick={async () => { const r = await api(`/shop/sites/${site.id}/rotate-key`, { method: "POST", body: {} }); if (r.ok) { show(t.rotated); onRotated(); } }}>{t.rotate}</button>
      {flash}
    </Panel>
  );
}
