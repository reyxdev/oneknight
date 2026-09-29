"use client";

import { useState } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { playSound, type SoundProfile } from "@/lib/sound";
import { Panel, useFlash } from "@/features/oneknight/ui/kit";

export type Look = { buttonAnim: "none" | "lift" | "pulse" | "shine"; hover: "none" | "glow" | "underline" | "scale"; sound: "off" | "soft" | "glass" | "wood"; notice: "toast" | "banner" | "minimal"; accent: string };
const ACCENTS: { id: string; hex: string }[] = [
  { id: "alby", hex: "#566f88" },
  { id: "ink", hex: "#0b0e13" },
  { id: "forest", hex: "#3f7a5a" },
  { id: "clay", hex: "#b8643f" },
];

/** Live customisation of the client's site: the preview here uses the same rules ok.js applies on the site. */
export function AppearancePanel({ siteId, domain, initial, canEdit }: { siteId: string; domain: string; initial: Look; canEdit: boolean }) {
  const d = useDict();
  const t = d.ok.site;
  const l = d.app.look;
  const [look, setLook] = useState<Look>(initial);
  const [dirty, setDirty] = useState(false);
  const [done, setDone] = useState(0);
  const [flash, show] = useFlash();
  const change = <K extends keyof Look>(k: K, v: Look[K]) => {
    setLook((x) => ({ ...x, [k]: v }));
    setDirty(true);
    if (k === "sound" && v !== "off") playSound("click", { force: true, profile: v as SoundProfile });
    if (k === "notice") setDone((n) => n + 1);
  };
  const save = async () => {
    const r = await api(`/sites/${siteId}/appearance`, { method: "PATCH", body: look });
    if (r.ok) {
      setDirty(false);
      show(l.saved);
      playSound("success");
    } else playSound("error");
  };
  const group = <K extends keyof Look>(k: K, label: string, values: Record<string, string>) => (
    <fieldset key={k}>
      <legend>{label}</legend>
      <div className="ok-chips">
        {Object.keys(values).map((v) => (
          <button key={v} type="button" className="ok-chip" aria-pressed={look[k] === v} data-sound="off" disabled={!canEdit} onClick={() => change(k, v as Look[K])}>{values[v]}</button>
        ))}
      </div>
    </fieldset>
  );
  return (
    <Panel title={l.title}>
      <p className="ok-muted">{l.lead}</p>
      <div className="ok-custom">
        <div className="ok-custom-opts">
          {group("buttonAnim", t.buttonAnim, t.anim)}
          {group("hover", t.hover, t.hoverFx)}
          {group("sound", t.sound, t.sounds)}
          {group("notice", t.notice, t.notices)}
          <fieldset>
            <legend>{t.accent}</legend>
            <div className="ok-chips">
              {ACCENTS.map((a) => (
                <button key={a.id} type="button" className="ok-chip" aria-pressed={look.accent.toLowerCase() === a.hex} disabled={!canEdit} onClick={() => change("accent", a.hex)}>
                  <i className="app-swatch" style={{ background: a.hex }} />{t.accents[a.id as keyof typeof t.accents]}
                </button>
              ))}
              <label className="ok-chip app-color">
                <input type="color" value={look.accent} disabled={!canEdit} onChange={(e) => change("accent", e.target.value)} aria-label={l.custom} />
                {l.custom}
              </label>
            </div>
          </fieldset>
        </div>
        <div className="ok-preview" style={{ ["--ok-accent" as string]: look.accent }} aria-label={t.preview}>
          <div className="ok-preview-bar"><i /><i /><i /><span>{domain}</span></div>
          <div className="ok-preview-page">
            <span className="ok-preview-img" />
            <h5>{t.previewTitle}</h5>
            <p>{t.previewText}</p>
            <button type="button" className="ok-pbtn" data-anim={look.buttonAnim} data-hover={look.hover} data-sound="off" onPointerDown={() => look.sound !== "off" && playSound("click", { force: true, profile: look.sound })} onClick={() => setDone((n) => n + 1)}>
              {t.previewBtn}
            </button>
            {done > 0 && <div className="ok-pnotice" data-style={look.notice} key={done} role="status"><Icon name="check" size={15} />{t.previewDone}</div>}
          </div>
        </div>
      </div>
      {canEdit && <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} disabled={!dirty} onClick={save}>{l.save}</button>}
      <details>
        <summary className="ok-link">{l.howTitle}</summary>
        <p className="ok-muted">{l.how}</p>
      </details>
      {flash}
    </Panel>
  );
}
