"use client";

import { useState } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { playSound, type SoundProfile } from "@/lib/sound";
import { useClient, useOkState } from "../state";
import { Panel, useFlash, useFormat } from "../ui/kit";
import type { Customization } from "@oneknight/domain";

type Opt<K extends keyof Customization> = { key: K; label: string; values: Record<Customization[K], string> };

export function Site() {
  const t = useDict().ok.site;
  const s = useOkState();
  const client = useClient();
  const f = useFormat();
  const c = s.customization;
  const [confirm, setConfirm] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState(0);
  const [flash, show] = useFlash();

  const opts = [
    { key: "buttonAnim", label: t.buttonAnim, values: t.anim },
    { key: "hover", label: t.hover, values: t.hoverFx },
    { key: "sound", label: t.sound, values: t.sounds },
    { key: "notice", label: t.notice, values: t.notices },
    { key: "accent", label: t.accent, values: t.accents },
  ] as Opt<keyof Customization>[];

  const change = <K extends keyof Customization>(key: K, v: Customization[K]) => {
    client.updateCustomization({ [key]: v } as Partial<Customization>);
    if (key === "sound" && v !== "off") playSound("click", { force: true, profile: v as SoundProfile });
    if (key === "notice") setNotice((n) => n + 1);
  };

  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <Panel title={t.custom}>
        <p className="ok-muted">{t.customLead}</p>
        <div className="ok-custom">
          <div className="ok-custom-opts">
            {opts.map((o) => (
              <fieldset key={o.key}>
                <legend>{o.label}</legend>
                <div className="ok-chips">
                  {(Object.keys(o.values) as Customization[typeof o.key][]).map((v) => (
                    <button key={String(v)} type="button" className="ok-chip" aria-pressed={c[o.key] === v} data-sound="off" onClick={() => change(o.key, v)}>
                      {o.values[v as keyof typeof o.values]}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="ok-preview" data-accent={c.accent} aria-label={t.preview}>
            <div className="ok-preview-bar"><i /><i /><i /><span>{s.sites.find((x) => x.id === s.activeSiteId)?.domain}</span></div>
            <div className="ok-preview-page">
              <span className="ok-preview-img" />
              <h5>{t.previewTitle}</h5>
              <p>{t.previewText}</p>
              <button
                type="button"
                className="ok-pbtn"
                data-anim={c.buttonAnim}
                data-hover={c.hover}
                data-sound="off"
                onPointerDown={() => c.sound !== "off" && playSound("click", { force: true, profile: c.sound })}
                onClick={() => {
                  setDone(true);
                  setNotice((n) => n + 1);
                }}
              >
                {t.previewBtn}
              </button>
              {done && notice > 0 && (
                <div className="ok-pnotice" data-style={c.notice} key={notice} role="status">
                  <Icon name="check" size={15} />
                  {t.previewDone}
                </div>
              )}
            </div>
          </div>
        </div>
      </Panel>
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
