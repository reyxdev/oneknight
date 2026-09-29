"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { useModal } from "@/components/global/ModalProvider";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { contacts, messengerLink } from "@/data/contacts";
import { formatUAH, websiteTypes } from "@/data/pricing";
import { useSignedIn } from "@/lib/session";
import { withLang } from "@/i18n";
import { playSound } from "@/lib/sound";
import { api } from "@/lib/api";

type View = "choose" | "call" | "brief" | "handoff" | "done";
type ServiceId = "website" | "automation" | "analytics" | "advertising" | "seo";
const SERVICES: ServiceId[] = ["website", "automation", "analytics", "advertising", "seo"];
const FEATURES = ["catalog", "cart", "payment", "delivery", "form", "multilang", "booking", "blog"] as const;

type Brief = {
  business: string;
  siteType: string;
  about: string;
  audience: string;
  logo: string;
  photos: string;
  features: string[];
  references: string;
  special: string;
};
const emptyBrief: Brief = { business: "", siteType: "unsure", about: "", audience: "", logo: "", photos: "", features: [], references: "", special: "" };

export function OrderModal() {
  const dict = useDict();
  const lang = useLang();
  const { state, close } = useModal();
  const signedIn = useSignedIn();
  const toast = useToast();
  const d = dict.order;

  const [view, setView] = useState<View>("choose");
  const [service, setService] = useState<ServiceId>("website");
  const [brief, setBrief] = useState<Brief>(emptyBrief);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [contact, setContact] = useState({ name: "", phone: "", email: "", website: "" });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [leadNo, setLeadNo] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.open) return;
    setErrors({});
    setSendError(null);
    if (state.start === "brief") {
      setService("website");
      setBrief((b) => ({ ...b, siteType: state.opts.siteType ?? "unsure" }));
      setView("brief");
    } else setView(state.start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.nonce]);

  const go = (v: View) => {
    setErrors({});
    setView(v);
    bodyRef.current?.scrollTo({ top: 0 });
  };

  /** ONEKNIGHT path: real account first (register or open the account), brief continues there. */
  const startOk = () => {
    window.location.href = withLang(lang, signedIn ? "/app/" : "/app/?start=register");
  };

  /** Sends the brief to ONEKNIGHT. If the server is unreachable, the messenger hand-off is offered instead. */
  const submitBrief = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const err: Record<string, string> = {};
    if (brief.business.trim().length < 3) err.business = d.brief.errBusiness;
    if (!signedIn) {
      if (contact.name.trim().length < 2) err.name = d.send.errContact;
      if (!/^\+?[0-9\s()-]{9,20}$/.test(contact.phone.trim())) err.phone = d.send.errContact;
    }
    setErrors(err);
    setSendError(null);
    if (Object.keys(err).length) {
      playSound("error");
      focusFirstInvalid(form);
      return;
    }
    setSending(true);
    const r = await api<{ number: number }>("/leads", {
      method: "POST",
      body: {
        service,
        ...(service === "website" ? { siteType: brief.siteType || "unsure" } : {}),
        business: brief.business,
        about: brief.about,
        audience: brief.audience,
        logo: brief.logo,
        photos: brief.photos,
        features: brief.features,
        references: brief.references,
        special: brief.special,
        locale: lang,
        ...(signedIn ? {} : { name: contact.name, phone: contact.phone, email: contact.email }),
        website: contact.website,
      },
    });
    setSending(false);
    if (r.ok) {
      playSound("success");
      setLeadNo(r.data.number);
      setBrief(emptyBrief);
      window.dispatchEvent(new Event("ok:lead-created"));
      go("done");
      return;
    }
    playSound("error");
    setSendError(r.status === 429 ? d.send.errLimit : r.error === "contact_required" ? d.send.errContact : d.send.errNetwork);
  };

  const selectedType = websiteTypes.find((t) => t.id === brief.siteType);

  const briefText = useMemo(() => {
    const L = d.briefLabels;
    const svc = d.service[service];
    const typeName = brief.siteType && brief.siteType in dict.siteTypes ? dict.siteTypes[brief.siteType as keyof typeof dict.siteTypes] : brief.siteType ? d.brief.siteTypeUnsure : "";
    const opt = (v: string) => (v === "have" ? d.brief.have : v === "need" ? d.brief.need : v === "no" ? d.brief.no : "");
    const featureNames = brief.features.map((f) => d.brief.featureList[f as (typeof FEATURES)[number]]).join(", ");
    const rows: [string, string][] = [
      [L.service, svc],
      [L.business, brief.business.trim()],
      [L.siteType, service === "website" ? typeName : ""],
      [L.about, brief.about.trim()],
      [L.audience, brief.audience.trim()],
      [L.logo, opt(brief.logo)],
      [L.photos, opt(brief.photos)],
      [L.features, featureNames],
      [L.references, brief.references.trim()],
      [L.special, brief.special.trim()],
    ];
    return [L.greeting, "", ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)].join("\n");
  }, [brief, service, d, dict.siteTypes]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(briefText);
    } catch {
      const ta = document.getElementById("brief-text") as HTMLTextAreaElement | null;
      ta?.select();
      document.execCommand("copy");
    }
    toast(dict.common.copied);
  };

  const title = {
    choose: d.title,
    call: d.callTitle,
    brief: d.brief.title,
    handoff: d.handoff.title,
    done: fmt(d.send.doneTitle, { n: leadNo ?? "" }),
  }[view];

  return (
    <Modal open={state.open} onClose={close} labelledBy="order-title">
      <div ref={bodyRef} className="p-6 pt-8 sm:p-10">
        {view !== "choose" && view !== "done" && (
          <button
            type="button"
            className="btn btn-ghost btn-sm mb-4 -ml-3"
            onClick={() => go(view === "handoff" ? "brief" : "choose")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
            {dict.common.back}
          </button>
        )}
        <h2 id="order-title" className="h2 mb-3 pr-10 !text-[clamp(1.75rem,4vw,2.5rem)]">{title}</h2>

        {view === "choose" && (
          <>
            <p className="lead mb-8">{d.lead}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice primary onClick={startOk} title={d.viaOk} text={d.viaOkText} />
              <Choice onClick={() => go("call")} title={d.call} text={d.callText} />
            </div>
          </>
        )}

        {view === "call" && (
          <>
            <p className="lead mb-6">{d.callLead}</p>
            <a className="btn btn-lg w-full" href={contacts.phone.tel}>{fmt(d.callButton, { phone: contacts.phone.display })}</a>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <a className="btn btn-secondary" href={contacts.telegram.url} target="_blank" rel="noopener">{dict.footer.telegram}</a>
              <a className="btn btn-secondary" href={contacts.viber.url}>{dict.footer.viber}</a>
              <a className="btn btn-secondary" href={contacts.whatsapp.url} target="_blank" rel="noopener">{dict.footer.whatsapp}</a>
              <a className="btn btn-secondary" href={contacts.facebook.url} target="_blank" rel="noopener">{dict.footer.facebook}</a>
            </div>
          </>
        )}

        {view === "brief" && (
          <form onSubmit={submitBrief} noValidate className="grid gap-5">
            <p className="lead">{d.brief.lead}</p>
            <Field label={d.send.service}>
              {(p) => (
                <select {...p} className="input" value={service} onChange={(e) => setService(e.target.value as ServiceId)}>
                  {SERVICES.map((sv) => (
                    <option key={sv} value={sv}>{d.service[sv]}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={d.brief.business} hint={d.brief.businessHint} error={errors.business}>
              {(p) => <input {...p} className="input" value={brief.business} onChange={(e) => setBrief({ ...brief, business: e.target.value })} />}
            </Field>
            {service === "website" && (
              <>
              <Field label={d.brief.siteType}>
                {(p) => (
                  <select {...p} className="input" value={brief.siteType} onChange={(e) => setBrief({ ...brief, siteType: e.target.value })}>
                    <option value="unsure">{d.brief.siteTypeUnsure}</option>
                    {websiteTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {dict.siteTypes[t.id]}, {fmt(dict.common.from, { price: formatUAH(t.from, lang) })}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {selectedType && <p className="small -mt-2">{fmt(dict.pricing.brief.priceLine, { price: formatUAH(selectedType.from, lang) })}</p>}
              </>
            )}
            <Field label={d.brief.about} optionalLabel={dict.common.optional}>
              {(p) => <textarea {...p} className="input" value={brief.about} onChange={(e) => setBrief({ ...brief, about: e.target.value })} />}
            </Field>
            <details className="rounded-[16px] border border-line p-4 open:pb-5">
              <summary className="cursor-pointer font-semibold">{d.brief.details}</summary>
              <div className="mt-4 grid gap-5">
                <Field label={d.brief.audience}>
                  {(p) => <input {...p} className="input" value={brief.audience} onChange={(e) => setBrief({ ...brief, audience: e.target.value })} />}
                </Field>
                <Radios label={d.brief.logo} value={brief.logo} onChange={(v) => setBrief({ ...brief, logo: v })} options={[["have", d.brief.have], ["need", d.brief.need], ["no", d.brief.no]]} />
                <Radios label={d.brief.photos} value={brief.photos} onChange={(v) => setBrief({ ...brief, photos: v })} options={[["have", d.brief.have], ["need", d.brief.need], ["no", d.brief.no]]} />
                {service === "website" && (
                  <fieldset className="grid gap-2">
                    <legend className="mb-1 text-[0.9375rem] font-semibold">{d.brief.features}</legend>
                    <div className="flex flex-wrap gap-2">
                      {FEATURES.map((f) => {
                        const on = brief.features.includes(f);
                        return (
                          <label key={f} className="chip" data-on={on}>
                            <input type="checkbox" className="sr-only" checked={on} onChange={() => setBrief({ ...brief, features: on ? brief.features.filter((x) => x !== f) : [...brief.features, f] })} />
                            {d.brief.featureList[f]}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
                <Field label={d.brief.references}>
                  {(p) => <input {...p} className="input" value={brief.references} onChange={(e) => setBrief({ ...brief, references: e.target.value })} />}
                </Field>
                <Field label={d.brief.special}>
                  {(p) => <textarea {...p} className="input" value={brief.special} onChange={(e) => setBrief({ ...brief, special: e.target.value })} />}
                </Field>
              </div>
            </details>
            {!signedIn && (
              <fieldset className="grid gap-4">
                <legend className="mb-2 text-[1.0625rem] font-bold">{d.send.contactTitle}</legend>
                <Field label={d.send.name} error={errors.name}>
                  {(p) => <input {...p} className="input" autoComplete="name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />}
                </Field>
                <Field label={d.send.phone} error={errors.phone}>
                  {(p) => <input {...p} className="input" type="tel" inputMode="tel" autoComplete="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />}
                </Field>
                <Field label={d.send.email} optionalLabel={dict.common.optional}>
                  {(p) => <input {...p} className="input" type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />}
                </Field>
              </fieldset>
            )}
            {/* Honeypot for bots: hidden from people and screen readers. */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" value={contact.website} onChange={(e) => setContact({ ...contact, website: e.target.value })} />
            {sendError && <p className="field-error" role="alert">{sendError}</p>}
            <button className="btn btn-lg" type="submit" disabled={sending} data-loading={sending}>{d.send.submit}</button>
            <button type="button" className="btn btn-ghost" onClick={() => go("handoff")}>{d.send.orMessenger}</button>
          </form>
        )}

        {view === "done" && (
          <div className="grid gap-5">
            <p className="lead">{d.send.doneText}</p>
            {signedIn && <p className="small">{d.send.doneApp}</p>}
            <div className="flex flex-wrap gap-3">
              {signedIn && !window.location.pathname.includes("/app") && (
                <a className="btn btn-lg" href={withLang(lang, "/app/")}>{d.send.openApp}</a>
              )}
              <button type="button" className="btn btn-lg btn-secondary" onClick={close}>{d.send.close}</button>
            </div>
          </div>
        )}

        {view === "handoff" && (
          <div className="grid gap-5">
            <p className="lead">{d.handoff.lead}</p>
            <Field label={d.handoff.text}>
              {(p) => <textarea {...p} id="brief-text" className="input" rows={9} readOnly value={briefText} />}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <a className="btn btn-lg" href={messengerLink("telegram", briefText)} target="_blank" rel="noopener">{d.handoff.telegram}</a>
              <a className="btn btn-lg btn-secondary" href={messengerLink("whatsapp", briefText)} target="_blank" rel="noopener">{d.handoff.whatsapp}</a>
              <a className="btn btn-secondary" href={contacts.viber.url} onClick={() => void copy()}>{d.handoff.viber}</a>
              <button type="button" className="btn btn-secondary" onClick={() => void copy()}>{dict.common.copy}</button>
            </div>
            <p className="small">{d.handoff.viberNote}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Choice({ title, text, onClick, primary }: { title: string; text: string; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`card card-hover grid content-start gap-2 p-5 text-left ${primary ? "!border-accent-strong !bg-surface-2" : ""}`} data-cursor="link">
      <span className="h3 !text-[1.25rem]">{title}</span>
      <span className="small">{text}</span>
    </button>
  );
}

function Radios({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-[0.9375rem] font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, t]) => (
          <label key={v} className="chip" data-on={value === v}>
            <input type="radio" className="sr-only" name={label} checked={value === v} onChange={() => onChange(v)} />
            {t}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function focusFirstInvalid(form: HTMLFormElement) {
  form.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
}

export type { ReactNode };
