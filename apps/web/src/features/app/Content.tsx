"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { api, type Me } from "@/lib/api";
import { Empty, Panel, useFormat } from "@/features/oneknight/ui/kit";
import { Tabs } from "./Tabs";
import { useToast } from "./Toasts";
import { useEscClose } from "./Table";

const CHANNELS = ["instagram", "facebook", "tiktok", "site", "telegram", "youtube", "viber"] as const;
type Channel = (typeof CHANNELS)[number];
type Bucket = "sale" | "benefit" | "trust" | "fun";
type Idea = {
  id: string;
  day: string;
  time: string;
  channel: Channel;
  also: Channel[];
  format: string;
  bucket: Bucket | "own";
  trigger: string;
  title: string;
  why: string;
  shot: string;
  textShort: string;
  textLong: string;
  cta: string;
  hashtags: string[];
  extra: { hooks?: string[]; stories?: { text: string; sticker: string }[]; slides?: { heading: string; photo: string }[]; article?: { topic: string; outline: string[] } | null };
  link: string | null;
  status: "todo" | "published" | "skipped" | "awaiting";
  custom: boolean;
  feedback: 1 | -1 | null;
  publishedAt: string | null;
  product: { id: string; name: string; photos: string[] } | null;
};
type Plan = { from: string; days: number; installed: boolean; beta: boolean; locked: number; ideas: Idea[]; holidays: { date: string; name: string; kind: string }[]; promos: { id: string; name: string; startsOn: string; endsOn: string; discount: number | null }[] };
type Settings = {
  channels: Partial<Record<Channel, { on: boolean; url?: string }>>;
  brief: { what?: string; unique?: string; audience?: string; goal?: "sales" | "awareness" | "loyal"; time?: "little" | "some" | "much" };
  voice: { address: "vy" | "ty"; tone: "friendly" | "business" | "playful"; emoji: boolean; avoid: string[] };
  rhythm: "light" | "normal" | "active" | "custom";
  custom: Partial<Record<Channel, number>>;
  balance: Record<Bucket, number>;
  daysOff: number[];
  wholesale: { min: number; discount: number } | null;
  approval: boolean;
  ownDates: { date: string; name: string }[];
  tag: string;
  siteId: string | null;
};

const kyivToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Monday of the week of a day. */
const monday = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

function ChannelBadge({ c }: { c: Channel }) {
  const t = useDict().app.content;
  return <span className="app-ch" data-ch={c}>{t.channels[c]}</span>;
}

/** The card of one idea: why, what to shoot, the texts (editable), format parts, the link, the result, the actions. */
function IdeaCard({ idea, installed, onChanged, onClose }: { idea: Idea; installed: boolean; onChanged: () => void; onClose: () => void }) {
  const d = useDict();
  const t = d.app.content;
  const lang = useLang();
  const toast = useToast();
  const [variant, setVariant] = useState<"short" | "long">("short");
  const [text, setText] = useState({ short: idea.textShort, long: idea.textLong });
  const [result, setResult] = useState<{ visits: number; orders: number; revenueKop: number | null } | null>(null);
  useEffect(() => {
    setText({ short: idea.textShort, long: idea.textLong });
  }, [idea.id, idea.textShort, idea.textLong]);
  const showResult = idea.status === "published" && idea.publishedAt && Date.now() - new Date(idea.publishedAt).getTime() >= 3 * 86_400_000;
  useEffect(() => {
    if (showResult) void api<typeof result>(`/content/ideas/${idea.id}/result`).then((r) => r.ok && setResult(r.data));
  }, [idea.id, showResult]);
  const patch = async (body: object, done?: string) => {
    const r = await api(`/content/ideas/${idea.id}`, { method: "PATCH", body });
    if (!r.ok) return toast.show(r.error === "owner_approves" ? t.ownerApproves : d.app.auth.errors.server_error, "warn");
    if (done) toast.show(done);
    onChanged();
  };
  const current = variant === "short" ? text.short : text.long;
  const full = `${current}${idea.cta ? `\n\n${idea.cta}` : ""}${idea.link ? `\n${idea.link}` : ""}\n\n${idea.hashtags.map((h) => `#${h}`).join(" ")}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full);
      toast.show(t.copied);
    } catch {
      toast.show(t.copyFailed, "warn");
    }
  };
  const e = idea.extra;
  return (
    <Panel className="ok-detail" title={idea.title} action={<button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={d.app.toast.close} onClick={onClose}><Icon name="close" size={16} /></button>}>
      <div className="app-idea-meta">
        <ChannelBadge c={idea.channel} />
        <span className="ok-pill">{(t.formats as Record<string, string>)[idea.format] ?? idea.format}</span>
        {idea.bucket !== "own" && <span className="ok-pill" data-bucket={idea.bucket}>{t.buckets[idea.bucket]}</span>}
        <label className="app-idea-when">
          <input type="date" className="input" aria-label={t.day} value={idea.day} disabled={!installed} onChange={(ev) => ev.target.value && patch({ day: ev.target.value }, t.moved)} />
          <input type="time" className="input" aria-label={t.time} value={idea.time} disabled={!installed} onChange={(ev) => ev.target.value && patch({ time: ev.target.value })} />
        </label>
      </div>
      {idea.also.length > 0 && <p className="ok-muted">{t.also} {idea.also.map((c) => t.channels[c]).join(", ")}</p>}
      <div className="app-idea-why"><b>{t.why}</b><p>{idea.why}</p></div>
      {idea.shot && <div className="app-idea-why"><b>{t.shot}</b><p>{idea.shot}</p></div>}
      {idea.product && (
        <div className="app-idea-product">
          {idea.product.photos.slice(0, 4).map((p) => (
            <a key={p} href={`/api/files/${p}`} download target="_blank" rel="noopener"><img src={`/api/files/${p}`} alt={idea.product!.name} /></a>
          ))}
          <small className="ok-muted">{idea.product.name}{idea.product.photos.length ? ` · ${t.downloadPhotos}` : ""}</small>
        </div>
      )}
      <Tabs label={t.text} value={variant} onChange={setVariant} tabs={[{ id: "short", label: t.variantShort }, { id: "long", label: t.variantLong }]} />
      <textarea className="input app-idea-text" rows={variant === "short" ? 4 : 9} value={current} disabled={!installed} onChange={(ev) => setText({ ...text, [variant]: ev.target.value })} onBlur={() => { if (text.short !== idea.textShort || text.long !== idea.textLong) void patch({ textShort: text.short, textLong: text.long }, t.saved); }} aria-label={t.text} />
      {idea.cta && <p><b>{t.cta}:</b> {idea.cta}</p>}
      <p className="app-idea-tags">{idea.hashtags.map((h) => `#${h}`).join(" ")}</p>
      {idea.link && <p className="ok-muted app-idea-link">{t.link}: <code>{idea.link}</code></p>}
      {e.hooks?.length ? <div className="app-idea-why"><b>{t.hooks}</b><ol>{e.hooks.map((h) => <li key={h}>{h}</li>)}</ol></div> : null}
      {e.stories?.length ? (
        <div className="app-idea-why">
          <b>{t.stories}</b>
          <ol>{e.stories.map((s, i) => <li key={i}>{s.text}{s.sticker !== "none" ? <small className="ok-muted"> · {t.stickers[s.sticker as keyof typeof t.stickers] ?? s.sticker}</small> : null}</li>)}</ol>
        </div>
      ) : null}
      {e.slides?.length ? <div className="app-idea-why"><b>{t.slides}</b><ol>{e.slides.map((s, i) => <li key={i}><b>{s.heading}</b><small className="ok-muted"> · {s.photo}</small></li>)}</ol></div> : null}
      {e.article ? <div className="app-idea-why"><b>{t.article}: {e.article.topic}</b><ol>{e.article.outline.map((o) => <li key={o}>{o}</li>)}</ol></div> : null}
      {result && (
        <div className="ok-kv">
          <div><span>{t.resVisits}</span><b className="num">{result.visits}</b></div>
          <div><span>{t.resOrders}</span><b className="num">{result.orders}</b></div>
          {result.revenueKop !== null && <div><span>{t.resRevenue}</span><b className="num app-secret">{formatUAH(result.revenueKop / 100, lang)}</b></div>}
        </div>
      )}
      {idea.status === "published" && !showResult && <p className="ok-muted">{t.resultLater}</p>}
      {installed ? (
        <div className="ok-actions">
          <button type="button" className="btn btn-sm" onClick={copy}><Icon name="copy" size={15} />{t.copy}</button>
          {idea.status !== "published" ? (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => patch({ status: "published" }, t.publishedDone)}><Icon name="check" size={15} />{idea.status === "awaiting" ? t.approveAndPublish : t.published}</button>
          ) : (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => patch({ status: "todo" })}>{t.notPublished}</button>
          )}
          {!idea.custom && idea.status !== "published" && <button type="button" className="btn btn-sm btn-ghost" onClick={async () => { const r = await api<Idea>(`/content/ideas/${idea.id}/other`, { method: "POST", body: {} }); if (!r.ok) return toast.show(r.error === "no_other" ? t.noOther : d.app.auth.errors.server_error, "warn"); onChanged(); onClose(); }}><Icon name="refresh" size={15} />{t.other}</button>}
          <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-pressed={idea.feedback === 1} aria-label={t.like} onClick={() => patch({ feedback: idea.feedback === 1 ? null : 1 })}>👍</button>
          <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-pressed={idea.feedback === -1} aria-label={t.dislike} onClick={() => patch({ feedback: idea.feedback === -1 ? null : -1 })}>👎</button>
          <button type="button" className="ok-link" onClick={async () => { const r = await api(`/content/ideas/${idea.id}/template`, { method: "POST", body: {} }); toast.show(r.ok ? t.templateSaved : d.app.auth.errors.server_error, r.ok ? "ok" : "warn"); }}>{t.saveTemplate}</button>
          <button type="button" className="ok-link ok-danger" onClick={async () => { await api(`/content/ideas/${idea.id}`, { method: "DELETE" }); onChanged(); onClose(); }}>{idea.custom ? t.remove : t.skip}</button>
        </div>
      ) : null}
    </Panel>
  );
}

/** First setup and later changes: channels with profile links, the brief, brand voice, rhythm, balance, days off. */
function SettingsForm({ initial, onSaved, onCancel }: { initial: Settings; onSaved: () => void; onCancel?: () => void }) {
  const d = useDict();
  const t = d.app.content;
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [avoid, setAvoid] = useState(initial.voice.avoid.join(", "));
  const [busy, setBusy] = useState(false);
  const sum = s.balance.sale + s.balance.benefit + s.balance.trust + s.balance.fun;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (sum !== 100) return toast.show(t.balanceSum, "warn");
    setBusy(true);
    const r = await api("/content/settings", { method: "PUT", body: { ...s, voice: { ...s.voice, avoid: avoid.split(",").map((x) => x.trim()).filter(Boolean) } } });
    setBusy(false);
    if (!r.ok) return toast.show(d.app.auth.errors.server_error, "warn");
    toast.show(t.settingsSaved);
    onSaved();
  };
  const ch = (c: Channel) => s.channels[c] ?? { on: false };
  return (
    <form className="grid gap-4" onSubmit={save}>
      <Panel title={t.channelsTitle}>
        <p className="ok-muted">{t.channelsLead}</p>
        {CHANNELS.map((c) => (
          <div key={c} className="app-ch-row">
            <Toggle checked={ch(c).on} onChange={(v) => setS({ ...s, channels: { ...s.channels, [c]: { ...ch(c), on: v } } })} label={t.channels[c]} />
            {ch(c).on && <input className="input" aria-label={fmt(t.profileUrl, { c: t.channels[c] })} placeholder={t.profileUrlHint} value={ch(c).url ?? ""} onChange={(e) => setS({ ...s, channels: { ...s.channels, [c]: { ...ch(c), url: e.target.value } } })} />}
          </div>
        ))}
      </Panel>
      <Panel title={t.briefTitle}>
        <Field label={t.brief.what} hint={t.brief.whatHint}>{(p) => <input {...p} className="input" maxLength={200} value={s.brief.what ?? ""} onChange={(e) => setS({ ...s, brief: { ...s.brief, what: e.target.value } })} />}</Field>
        <Field label={t.brief.unique}>{(p) => <input {...p} className="input" maxLength={300} value={s.brief.unique ?? ""} onChange={(e) => setS({ ...s, brief: { ...s.brief, unique: e.target.value } })} />}</Field>
        <Field label={t.brief.audience}>{(p) => <input {...p} className="input" maxLength={300} value={s.brief.audience ?? ""} onChange={(e) => setS({ ...s, brief: { ...s.brief, audience: e.target.value } })} />}</Field>
        <Field label={t.brief.goal}>
          {(p) => (
            <select {...p} className="input" value={s.brief.goal ?? ""} onChange={(e) => setS({ ...s, brief: { ...s.brief, goal: (e.target.value || undefined) as Settings["brief"]["goal"] } })}>
              <option value="">—</option>
              {(["sales", "awareness", "loyal"] as const).map((g) => <option key={g} value={g}>{t.goals[g]}</option>)}
            </select>
          )}
        </Field>
        <Field label={t.brief.time}>
          {(p) => (
            <select {...p} className="input" value={s.brief.time ?? ""} onChange={(e) => { const time = (e.target.value || undefined) as Settings["brief"]["time"]; setS({ ...s, brief: { ...s.brief, time }, rhythm: time === "little" ? "light" : time === "much" ? "active" : time === "some" ? "normal" : s.rhythm }); }}>
              <option value="">—</option>
              {(["little", "some", "much"] as const).map((g) => <option key={g} value={g}>{t.times[g]}</option>)}
            </select>
          )}
        </Field>
      </Panel>
      <Panel title={t.voiceTitle}>
        <div className="ok-seg" role="radiogroup" aria-label={t.address}>
          {(["vy", "ty"] as const).map((a) => <button key={a} type="button" role="radio" aria-checked={s.voice.address === a} onClick={() => setS({ ...s, voice: { ...s.voice, address: a } })}>{t.addresses[a]}</button>)}
        </div>
        <div className="ok-seg" role="radiogroup" aria-label={t.tone}>
          {(["friendly", "business", "playful"] as const).map((a) => <button key={a} type="button" role="radio" aria-checked={s.voice.tone === a} onClick={() => setS({ ...s, voice: { ...s.voice, tone: a } })}>{t.tones[a]}</button>)}
        </div>
        <Toggle checked={s.voice.emoji} onChange={(v) => setS({ ...s, voice: { ...s.voice, emoji: v } })} label={t.emoji} />
        <Field label={t.avoid} hint={t.avoidHint}>{(p) => <input {...p} className="input" value={avoid} onChange={(e) => setAvoid(e.target.value)} />}</Field>
        <Field label={t.tag} hint={t.tagHint}>{(p) => <input {...p} className="input" maxLength={40} value={s.tag} onChange={(e) => setS({ ...s, tag: e.target.value.replace(/\s/g, "") })} />}</Field>
      </Panel>
      <Panel title={t.rhythmTitle}>
        <div className="ok-seg" role="radiogroup" aria-label={t.rhythmTitle}>
          {(["light", "normal", "active", "custom"] as const).map((r) => <button key={r} type="button" role="radio" aria-checked={s.rhythm === r} onClick={() => setS({ ...s, rhythm: r })}>{t.rhythms[r]}</button>)}
        </div>
        {s.rhythm === "custom" && (
          <div className="app-ch-counts">
            {CHANNELS.filter((c) => ch(c).on).map((c) => (
              <Field key={c} label={fmt(t.perWeek, { c: t.channels[c] })}>{(p) => <input {...p} className="input" type="number" min={0} max={14} value={s.custom[c] ?? ""} onChange={(e) => setS({ ...s, custom: { ...s.custom, [c]: Number(e.target.value) } })} />}</Field>
            ))}
          </div>
        )}
        <p className="ok-muted">{t.rhythmHint}</p>
        <div className="app-balance">
          {(["sale", "benefit", "trust", "fun"] as const).map((b) => (
            <Field key={b} label={`${t.buckets[b]}, %`}>{(p) => <input {...p} className="input" type="number" min={0} max={100} value={s.balance[b]} onChange={(e) => setS({ ...s, balance: { ...s.balance, [b]: Number(e.target.value) } })} />}</Field>
          ))}
        </div>
        <p className="ok-muted" data-bad={sum !== 100 || undefined}>{fmt(t.balanceNow, { n: sum })}</p>
        <fieldset className="app-q">
          <legend>{t.daysOff}</legend>
          <div className="ok-chips">
            {[1, 2, 3, 4, 5, 6, 0].map((wd) => <button key={wd} type="button" className="ok-chip" aria-pressed={s.daysOff.includes(wd)} onClick={() => setS({ ...s, daysOff: s.daysOff.includes(wd) ? s.daysOff.filter((x) => x !== wd) : [...s.daysOff, wd] })}>{t.weekdays[wd]}</button>)}
          </div>
          <p className="ok-muted">{t.daysOffHint}</p>
        </fieldset>
        <Toggle checked={s.approval} onChange={(v) => setS({ ...s, approval: v })} label={t.approval} />
      </Panel>
      <Panel title={t.wholesaleTitle}>
        <Toggle checked={!!s.wholesale} onChange={(v) => setS({ ...s, wholesale: v ? { min: 10, discount: 10 } : null })} label={t.wholesaleOn} />
        {s.wholesale && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.wholesaleMin}>{(p) => <input {...p} className="input" type="number" min={2} value={s.wholesale!.min} onChange={(e) => setS({ ...s, wholesale: { ...s.wholesale!, min: Number(e.target.value) } })} />}</Field>
            <Field label={t.wholesaleDiscount} hint={t.wholesaleHint}>{(p) => <input {...p} className="input" type="number" min={1} max={90} value={s.wholesale!.discount} onChange={(e) => setS({ ...s, wholesale: { ...s.wholesale!, discount: Number(e.target.value) } })} />}</Field>
          </div>
        )}
      </Panel>
      <Panel title={t.ownDatesTitle}>
        {s.ownDates.map((o, i) => (
          <div key={i} className="app-pay-row">
            <input className="input" aria-label={t.ownDateName} placeholder={t.ownDateName} value={o.name} onChange={(e) => setS({ ...s, ownDates: s.ownDates.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <input className="input" aria-label={t.ownDate} placeholder="MM-DD" maxLength={5} value={o.date} onChange={(e) => setS({ ...s, ownDates: s.ownDates.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
            <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t.remove} onClick={() => setS({ ...s, ownDates: s.ownDates.filter((_, j) => j !== i) })}><Icon name="close" size={14} /></button>
          </div>
        ))}
        <button type="button" className="ok-link" style={{ justifySelf: "start" }} onClick={() => setS({ ...s, ownDates: [...s.ownDates, { date: "", name: "" }] })}><Icon name="plus" size={13} /> {t.ownDateAdd}</button>
      </Panel>
      <div className="ok-actions">
        <button type="submit" className="btn" disabled={busy || !CHANNELS.some((c) => ch(c).on)} data-loading={busy}>{t.saveSettings}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>{t.cancel}</button>}
      </div>
    </form>
  );
}

/** «Акції»: own promotions with dates; the plan announces, reminds and says «останній день». */
function Promos({ onChanged }: { onChanged: () => void }) {
  const d = useDict();
  const t = d.app.content;
  const f = useFormat();
  const toast = useToast();
  const [list, setList] = useState<Plan["promos"]>([]);
  const today = kyivToday();
  const [form, setForm] = useState({ name: "", discount: "", startsOn: today, endsOn: addDays(today, 7) });
  const load = useCallback(async () => {
    const r = await api<Plan["promos"]>("/content/promos");
    if (r.ok) setList(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Panel title={t.promosTitle}>
      <p className="ok-muted">{t.promosLead}</p>
      <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); const r = await api("/content/promos", { method: "POST", body: { name: form.name.trim(), discount: form.discount ? Number(form.discount) : null, startsOn: form.startsOn, endsOn: form.endsOn } }); if (!r.ok) return toast.show(t.promoError, "warn"); toast.show(t.promoAdded); setForm({ ...form, name: "", discount: "" }); void load(); onChanged(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.promoName}>{(p) => <input {...p} className="input" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label={t.promoDiscount}>{(p) => <input {...p} className="input" inputMode="numeric" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value.replace(/\D/g, "").slice(0, 2) })} />}</Field>
          <Field label={t.promoFrom}>{(p) => <input {...p} className="input" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} />}</Field>
          <Field label={t.promoTo}>{(p) => <input {...p} className="input" type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />}</Field>
        </div>
        <button type="submit" className="btn btn-sm" style={{ justifySelf: "start" }} disabled={form.name.trim().length < 2}>{t.promoAdd}</button>
      </form>
      {list.length > 0 && (
        <ul className="ok-list">
          {list.map((p) => (
            <li key={p.id}>
              <span className="ok-grow app-cell-main"><b>{p.name}{p.discount ? ` −${p.discount}%` : ""}</b><small>{f.date(new Date(p.startsOn).getTime())} — {f.date(new Date(p.endsOn).getTime())}</small></span>
              <button type="button" className="ok-link ok-danger" onClick={async () => { await api(`/content/promos/${p.id}`, { method: "DELETE" }); void load(); onChanged(); }}>{t.remove}</button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * «Контент»: the plan of posts for the business's channels, built from its real data. The week as a list (today on
 * top on a phone) or the month as a grid; the idea card on the right; settings and promotions.
 */
export function ContentScreen({ me, goModules }: { me: Me; goModules: () => void }) {
  const d = useDict();
  const t = d.app.content;
  const f = useFormat();
  const toast = useToast();
  const [view, setView] = useState<"week" | "month" | "settings" | "promos">("week");
  const [start, setStart] = useState(() => monday(kyivToday()));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [cfg, setCfg] = useState<{ settings: Settings; configured: boolean; installed: boolean; beta: boolean } | null>(null);
  const [channel, setChannel] = useState<Channel | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [own, setOwn] = useState<{ day: string; channel: Channel; title: string; text: string } | null>(null);
  const today = kyivToday();
  const monthStart = useMemo(() => monday(`${start.slice(0, 8)}01`), [start]);
  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      api<{ settings: Settings; configured: boolean; installed: boolean; beta: boolean }>("/content/settings"),
      api<Plan>(`/content/plan?from=${view === "month" ? monthStart : start}&days=${view === "month" ? 42 : 7}${channel === "all" ? "" : `&channel=${channel}`}`),
    ]);
    if (c.ok) setCfg(c.data);
    if (p.ok) setPlan(p.data);
  }, [start, view, monthStart, channel]);
  useEffect(() => {
    if (view === "week" || view === "month") void load();
  }, [load, view]);
  useEscClose(open ? () => setOpen(null) : null);
  if (!cfg || !plan) return null;
  const idea = plan.ideas.find((i) => i.id === open) ?? null;
  const on = CHANNELS.filter((c) => cfg.settings.channels[c]?.on);

  // Without the module: 3 real ideas of this week and what the rest would be.
  const header = (
    <div className="ok-h">
      <h3>{t.title}</h3>
      {cfg.installed && (
        <div className="ok-actions">
          <div className="ok-seg" role="radiogroup" aria-label={t.view}>
            {(["week", "month"] as const).map((v) => <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>{t.views[v]}</button>)}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setView("promos")}>{t.promosTitle}</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setView("settings")}><Icon name="settings" size={15} />{t.settings}</button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={async () => { const r = await api<{ made: number }>("/content/plan/refresh", { method: "POST", body: {} }); toast.show(r.ok ? fmt(t.refreshed, { n: r.data.made }) : d.app.auth.errors.server_error, r.ok ? "ok" : "warn"); void load(); }}><Icon name="refresh" size={15} />{t.refresh}</button>
        </div>
      )}
    </div>
  );
  if (!cfg.installed)
    return (
      <div className="ok-screen">
        {header}
        <Panel>
          <p>{t.preview}</p>
          {plan.ideas.length === 0 ? <p className="ok-muted">{t.previewEmpty}</p> : (
            <ul className="app-ideas">
              {plan.ideas.map((i) => <li key={i.id}><button type="button" className="app-idea" onClick={() => setOpen(i.id)}><span className="num ok-muted">{f.date(new Date(i.day).getTime())} {i.time}</span><ChannelBadge c={i.channel} /><b>{i.title}</b><small className="ok-muted">{i.why}</small></button></li>)}
            </ul>
          )}
          {plan.locked > 0 && <p className="ok-note"><Icon name="lock" size={14} /> {fmt(t.lockedMore, { n: plan.locked })}</p>}
          {cfg.beta ? <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} onClick={goModules}><Icon name="puzzle" size={15} />{t.install}</button> : <p className="ok-muted">{t.betaOnly}</p>}
        </Panel>
        {idea && <IdeaCard key={idea.id} idea={idea} installed={false} onChanged={load} onClose={() => setOpen(null)} />}
      </div>
    );
  if (!cfg.configured || view === "settings")
    return (
      <div className="ok-screen">
        {header}
        {!cfg.configured && <p className="ok-muted">{t.setupLead}</p>}
        <SettingsForm initial={cfg.settings} onSaved={() => { setView("week"); void load(); }} onCancel={cfg.configured ? () => setView("week") : undefined} />
      </div>
    );
  if (view === "promos")
    return (
      <div className="ok-screen">
        {header}
        <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: "start" }} onClick={() => setView("week")}><Icon name="arrow" size={15} style={{ transform: "scaleX(-1)" }} />{t.back}</button>
        <Promos onChanged={load} />
      </div>
    );

  const days = Array.from({ length: view === "month" ? 42 : 7 }, (_, i) => addDays(view === "month" ? monthStart : start, i));
  const markers = (day: string) => [...plan.holidays.filter((h) => h.date === day).map((h) => ({ k: `h${h.name}`, text: h.name, kind: h.kind })), ...plan.promos.filter((p) => p.startsOn <= day && p.endsOn >= day).map((p) => ({ k: `p${p.id}`, text: p.name, kind: "promo" }))];
  const ofDay = (day: string) => plan.ideas.filter((i) => i.day === day && i.status !== "skipped");
  const move = async (id: string, day: string) => {
    const r = await api(`/content/ideas/${id}`, { method: "PATCH", body: { day } });
    if (r.ok) toast.show(t.moved);
    void load();
  };
  // On a phone today goes first (K75); in the week list the order stays by date elsewhere.
  const weekDays = typeof window !== "undefined" && window.innerWidth < 700 ? [...days.filter((x) => x >= today), ...days.filter((x) => x < today)] : days;
  return (
    <div className="ok-screen">
      {header}
      <div className="ok-chips app-content-bar">
        <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t.prev} onClick={() => setStart(view === "month" ? monday(addDays(monthStart, -7)) : addDays(start, -7))}><Icon name="arrow" size={15} style={{ transform: "scaleX(-1)" }} /></button>
        <b className="num">{view === "month" ? new Date(`${addDays(monthStart, 14)}T12:00:00Z`).toLocaleDateString("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" }) : `${f.date(new Date(start).getTime())} — ${f.date(new Date(addDays(start, 6)).getTime())}`}</b>
        <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t.next} onClick={() => setStart(view === "month" ? monday(addDays(monthStart, 42)) : addDays(start, 7))}><Icon name="arrow" size={15} /></button>
        <button type="button" className="ok-chip" onClick={() => setStart(monday(today))}>{t.today}</button>
        <span className="ok-grow" />
        <button type="button" className="ok-chip" aria-pressed={channel === "all"} onClick={() => setChannel("all")}>{t.allChannels}</button>
        {on.map((c) => <button key={c} type="button" className="ok-chip" aria-pressed={channel === c} onClick={() => setChannel(c)}>{t.channels[c]}</button>)}
      </div>
      {view === "month" ? (
        <div className="app-month" role="grid" aria-label={t.views.month}>
          {[1, 2, 3, 4, 5, 6, 0].map((wd) => <div key={wd} role="columnheader" className="app-month-head">{t.weekdaysShort[wd]}</div>)}
          {days.map((day) => (
            <button key={day} type="button" role="gridcell" className="app-month-day" data-today={day === today || undefined} data-other={day.slice(5, 7) !== addDays(monthStart, 14).slice(5, 7) || undefined} onClick={() => { setStart(monday(day)); setView("week"); }}>
              <span className="num">{Number(day.slice(8))}</span>
              {markers(day).map((m) => <small key={m.k} className="app-marker" data-kind={m.kind}>{m.text}</small>)}
              <span className="app-month-dots">{ofDay(day).map((i) => <i key={i.id} data-ch={i.channel} data-done={i.status === "published" || undefined} title={i.title} />)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="ok-split" data-open={!!idea}>
          <div className="app-week">
            {weekDays.map((day) => (
              <section key={day} className="app-day" data-today={day === today || undefined} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (drag) void move(drag, day); setDrag(null); }} aria-label={day}>
                <header>
                  <b>{t.weekdays[new Date(`${day}T12:00:00Z`).getUTCDay()]}, {f.date(new Date(day).getTime())}{day === today ? ` · ${t.today}` : ""}</b>
                  {markers(day).map((m) => <span key={m.k} className="app-marker" data-kind={m.kind}>{m.text}</span>)}
                  <button type="button" className="ok-link" onClick={() => setOwn({ day, channel: on[0] ?? "instagram", title: "", text: "" })}><Icon name="plus" size={13} /> {t.ownIdea}</button>
                </header>
                {ofDay(day).length === 0 ? <p className="ok-muted">{cfg.settings.daysOff.includes(new Date(`${day}T12:00:00Z`).getUTCDay()) ? t.dayOff : t.noIdeas}</p> : (
                  <ul className="app-ideas">
                    {ofDay(day).map((i) => (
                      <li key={i.id}>
                        <button type="button" className="app-idea" data-status={i.status} aria-current={open === i.id || undefined} draggable onDragStart={() => setDrag(i.id)} onClick={() => setOpen(i.id)}>
                          <span className="num ok-muted">{i.time}</span>
                          <ChannelBadge c={i.channel} />
                          <span className="ok-pill">{(t.formats as Record<string, string>)[i.format] ?? i.format}</span>
                          <b>{i.title}</b>
                          {i.status === "published" && <span className="ok-pill" data-s="done">{t.statuses.published}</span>}
                          {i.status === "awaiting" && <span className="ok-pill" data-s="shipped">{t.statuses.awaiting}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {own?.day === day && (
                  <form className="grid gap-2 app-own" onSubmit={async (e) => { e.preventDefault(); const r = await api("/content/ideas", { method: "POST", body: own }); if (!r.ok) return toast.show(d.app.auth.errors.server_error, "warn"); setOwn(null); void load(); }}>
                    <select className="input" aria-label={t.channel} value={own.channel} onChange={(e) => setOwn({ ...own, channel: e.target.value as Channel })}>{on.map((c) => <option key={c} value={c}>{t.channels[c]}</option>)}</select>
                    <input className="input" aria-label={t.ownTitle} placeholder={t.ownTitle} maxLength={120} value={own.title} onChange={(e) => setOwn({ ...own, title: e.target.value })} />
                    <textarea className="input" aria-label={t.text} placeholder={t.text} rows={3} value={own.text} onChange={(e) => setOwn({ ...own, text: e.target.value })} />
                    <div className="ok-actions">
                      <button type="submit" className="btn btn-sm" disabled={!own.title.trim()}>{t.ownAdd}</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOwn(null)}>{t.cancel}</button>
                    </div>
                  </form>
                )}
              </section>
            ))}
            {plan.ideas.length === 0 && <Empty icon="megaphone" text={t.emptyWeek} />}
          </div>
          {idea && <IdeaCard key={idea.id} idea={idea} installed onChanged={load} onClose={() => setOpen(null)} />}
        </div>
      )}
      <p className="ok-muted">{t.how}</p>
    </div>
  );
}
