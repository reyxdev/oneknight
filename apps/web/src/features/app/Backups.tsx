"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, useFlash, useFormat } from "@/features/oneknight/ui/kit";

type Backup = { id: string; kind: "auto" | "manual"; size: number; counts: Record<string, number>; createdAt: string };

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** Owner: automatic daily copies of the business data, manual copy, download. */
export function BackupsPanel() {
  const t = useDict().app.backups;
  const f = useFormat();
  const [flash, show] = useFlash();
  const [rows, setRows] = useState<Backup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await api<Backup[]>("/backups");
    if (r.ok) setRows(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const create = async () => {
    setBusy(true);
    const r = await api("/backups", { method: "POST", body: {} });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      return show((t.errors as Record<string, string>)[r.error] ?? t.errors.too_many_requests, "warn");
    }
    playSound("success");
    show(t.created);
    void load();
  };
  return (
    <Panel title={t.title} action={<button type="button" className="btn btn-sm" disabled={busy} data-loading={busy} onClick={create}>{busy ? t.creating : t.create}</button>}>
      <p className="ok-muted">{t.lead}</p>
      {rows && rows.length === 0 ? (
        <p className="ok-muted">{t.empty}</p>
      ) : (
        <ul className="ok-list">
          {(rows ?? []).map((b) => (
            <li key={b.id}>
              <span className="ok-grow">
                <b>{f.dateTime(new Date(b.createdAt).getTime())}</b>
                <small>{t.kinds[b.kind]} · {size(b.size)} · {fmt(t.counts, { products: b.counts.products ?? 0, orders: b.counts.orders ?? 0, reviews: b.counts.reviews ?? 0 })}</small>
              </span>
              <a className="ok-link" href={`/api/backups/${b.id}/download`} download>{t.download}</a>
            </li>
          ))}
        </ul>
      )}
      <p className="ok-muted">{t.restore}</p>
      {flash}
    </Panel>
  );
}
