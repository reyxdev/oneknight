"use client";

import { useState } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { useClient, useOkState } from "../state";
import { Panel, useFlash, useFormat } from "../ui/kit";

export function Site() {
  const t = useDict().ok.site;
  const s = useOkState();
  const client = useClient();
  const f = useFormat();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [flash, show] = useFlash();

  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <div className="ok-grid-2">
        <Panel title={t.monitoring}>
          <ul className="ok-list">
            {s.checks.map((ch) => (
              <li key={ch.id}>
                <i className="ok-state" data-s={ch.state} aria-hidden="true" />
                <span className="ok-grow">{t.checks[ch.id]}</span>
                <b className="num">{ch.value}</b>
              </li>
            ))}
          </ul>
          <p className="ok-muted">{t.monitoringNote}</p>
        </Panel>
        <Panel
          title={t.backups}
          action={
            <button type="button" className="btn btn-sm btn-secondary" data-sound="success" onClick={() => client.runBackup()}>
              <Icon name="refresh" size={15} />{t.backupNow}
            </button>
          }
        >
          <ul className="ok-list">
            {s.backups.slice(0, 5).map((b) => (
              <li key={b.id}>
                <Icon name="shield" size={16} className="ok-muted" />
                <span className="ok-grow">{f.dateTime(b.at)} <small className="ok-muted">· {b.auto ? t.auto : t.manual} · {b.size}</small></span>
                {confirm === b.id ? (
                  <span className="ok-actions">
                    <button type="button" className="btn btn-sm" onClick={() => { client.restoreBackup(b.id); setConfirm(null); show(t.applied); }}>{t.yes}</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>{t.no}</button>
                  </span>
                ) : (
                  <button type="button" className="ok-link" onClick={() => setConfirm(b.id)} aria-label={`${t.restore}: ${f.dateTime(b.at)}`}>{t.restore}</button>
                )}
              </li>
            ))}
          </ul>
          {confirm && <p className="ok-muted" role="alert">{t.restoreConfirm}</p>}
        </Panel>
      </div>
      {flash}
    </div>
  );
}
