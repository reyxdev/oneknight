"use client";

import { useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { KnightMark } from "@/components/global/Logo";
import { api, type Me } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { TelegramPanel } from "./TelegramPanel";

const SELLS = ["clothes", "home", "handmade", "beauty", "tech", "food", "kids", "services", "other"] as const;
const DELIVERY = ["novaposhta", "ukrposhta", "pickup", "courier"] as const;
const CHANNELS = ["instagram", "facebook", "tiktok", "prom", "rozetka", "olx", "none"] as const;
type Answers = { hasSite: boolean | null; siteUrl: string; sells: string[]; sellsOther: string; delivery: string[]; channels: string[] };

/** Modules that fit the answers, each with the reason (only modules that exist; «скоро» is said honestly). */
export function recommend(a: { hasSite: boolean | null; delivery: string[]; channels: string[] }) {
  const out: { id: string; why: "delivery" | "channel" | "analytics" | "reviews" }[] = [];
  for (const id of ["novaposhta", "ukrposhta"]) if (a.delivery.includes(id)) out.push({ id, why: "delivery" });
  for (const id of ["prom", "rozetka", "olx"]) if (a.channels.includes(id)) out.push({ id, why: "channel" });
  if (a.hasSite) out.push({ id: "analytics", why: "analytics" }, { id: "reviews", why: "reviews" });
  return out;
}

/**
 * Right after sign-up (owner): four questions without «Пропустити», then advice (modules, the way to a website),
 * Telegram and «Почати пробний період».
 */
export function Onboarding({ me, onDone }: { me: Me; onDone: (go?: [string, string?]) => void }) {
  const d = useDict();
  const t = d.app.onboarding;
  const [a, setA] = useState<Answers>({ hasSite: null, siteUrl: "", sells: [], sellsOther: "", delivery: [], channels: [] });
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<"questions" | "advice">("questions");
  const [busy, setBusy] = useState(false);
  const [trial, setTrial] = useState<"none" | "started" | "had" | "used">(me.subscription ? "had" : "none");

  const toggle = (k: "sells" | "delivery" | "channels", v: string) =>
    setA((x) => {
      const has = x[k].includes(v);
      // «Ніде» excludes the rest and the other way round.
      const next = has ? x[k].filter((y) => y !== v) : k === "channels" && v === "none" ? ["none"] : [...x[k].filter((y) => !(k === "channels" && y === "none")), v];
      return { ...x, [k]: next };
    });
  const chips = (k: "sells" | "delivery" | "channels", list: readonly string[], labels: Record<string, string>) => (
    <div className="ok-chips" role="group">
      {list.map((v) => (
        <button key={v} type="button" className="ok-chip" aria-pressed={a[k].includes(v)} onClick={() => toggle(k, v)}>{labels[v]}</button>
      ))}
    </div>
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = a.hasSite === null ? t.q.site : !a.sells.length ? t.q.sells : a.sells.includes("other") && !a.sellsOther.trim() ? t.q.sellsOther : !a.delivery.length ? t.q.delivery : !a.channels.length ? t.q.channels : null;
    if (missing) {
      playSound("error");
      return setErr(fmt(t.answer, { q: missing }));
    }
    setBusy(true);
    const r = await api<{ trialUntil: string | null }>("/onboarding", {
      method: "POST",
      body: { hasSite: a.hasSite, ...(a.siteUrl.trim() ? { siteUrl: a.siteUrl.trim() } : {}), sells: a.sells, ...(a.sells.includes("other") ? { sellsOther: a.sellsOther.trim() } : {}), delivery: a.delivery, channels: a.channels },
    });
    setBusy(false);
    if (!r.ok && r.error !== "already_answered") return setErr(d.app.auth.errors.server_error);
    // The 30-day trial starts by itself; without it this phone already had one.
    if (r.ok) setTrial(r.data.trialUntil ? "started" : me.subscription ? "had" : "used");
    playSound("success");
    setStep("advice");
  };
  const startTrial = async () => {
    const r = await api("/billing/trial", { method: "POST" });
    if (r.ok) {
      playSound("success");
      setTrial("started");
    } else if (r.error === "already_started") setTrial("had");
    else if (r.error === "trial_used") setTrial("used");
  };

  const recs = recommend(a);
  const names = d.ok.modules.items as Record<string, { name: string }>;
  return (
    <main className="app-auth app-onboarding">
      <div className="app-auth-card card">
        <span className="app-auth-brand"><KnightMark size={36} /><b>ONEKNIGHT</b></span>
        {step === "questions" ? (
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <div>
              <h1 className="h3">{fmt(t.title, { name: me.name })}</h1>
              <p className="small">{t.lead}</p>
            </div>
            <fieldset className="app-q">
              <legend>{t.q.site}</legend>
              <div className="ok-chips" role="group">
                {([true, false] as const).map((v) => (
                  <button key={String(v)} type="button" className="ok-chip" aria-pressed={a.hasSite === v} onClick={() => setA({ ...a, hasSite: v })}>{v ? t.yes : t.no}</button>
                ))}
              </div>
              {a.hasSite && <Field label={t.siteUrl} optionalLabel={t.optional}>{(p) => <input {...p} className="input" inputMode="url" placeholder="myshop.com.ua" value={a.siteUrl} onChange={(e) => setA({ ...a, siteUrl: e.target.value })} />}</Field>}
            </fieldset>
            <fieldset className="app-q">
              <legend>{t.q.sells}</legend>
              {chips("sells", SELLS, t.sells)}
              {a.sells.includes("other") && <Field label={t.q.sellsOther}>{(p) => <input {...p} className="input" maxLength={100} value={a.sellsOther} onChange={(e) => setA({ ...a, sellsOther: e.target.value })} />}</Field>}
            </fieldset>
            <fieldset className="app-q">
              <legend>{t.q.delivery}</legend>
              {chips("delivery", DELIVERY, t.delivery)}
            </fieldset>
            <fieldset className="app-q">
              <legend>{t.q.channels}</legend>
              {chips("channels", CHANNELS, t.channels)}
            </fieldset>
            {err && <p className="field-error" role="alert">{err}</p>}
            <button className="btn btn-lg" type="submit" disabled={busy} data-loading={busy}>{t.next}</button>
          </form>
        ) : (
          <div className="grid gap-5">
            <div>
              <h1 className="h3">{t.adviceTitle}</h1>
              <p className="small">{t.adviceLead}</p>
            </div>
            <section className="grid gap-2">
              <h2 className="app-q-title">{t.pathTitle}</h2>
              <p className="small">{a.hasSite ? t.pathHasSite : t.pathNoSite}</p>
              <button type="button" className="btn btn-secondary" style={{ justifySelf: "start" }} onClick={() => onDone(a.hasSite ? ["site"] : ["services"])}>{a.hasSite ? t.pathHasSiteCta : t.pathNoSiteCta}</button>
            </section>
            {recs.length > 0 && (
              <section className="grid gap-2">
                <h2 className="app-q-title">{t.modulesTitle}</h2>
                <ul className="app-recs">
                  {recs.map((r) => (
                    <li key={r.id}><Icon name="puzzle" size={16} /><span className="ok-grow"><b>{names[r.id]?.name ?? r.id}</b><small>{t.why[r.why]}</small></span></li>
                  ))}
                </ul>
                <button type="button" className="ok-link" style={{ justifySelf: "start" }} onClick={() => onDone(["modules"])}>{t.toModules}</button>
              </section>
            )}
            <section className="grid gap-2">
              <h2 className="app-q-title">{t.trialTitle}</h2>
              {trial === "none" && <><p className="small">{t.trialLead}</p><button type="button" className="btn" style={{ justifySelf: "start" }} onClick={startTrial}>{t.trialCta}</button></>}
              {trial === "started" && <p className="ok-note" role="status"><Icon name="check" size={15} />{t.trialStarted}</p>}
              {trial === "had" && <p className="small">{t.trialHad}</p>}
              {trial === "used" && <p className="small">{t.trialUsed}</p>}
            </section>
            <TelegramPanel />
            <button type="button" className="btn btn-lg" onClick={() => onDone()}>{t.toPanel}</button>
          </div>
        )}
      </div>
    </main>
  );
}
