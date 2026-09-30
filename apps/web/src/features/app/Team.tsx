"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { api, type Me } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, useFlash, useFormat } from "@/features/oneknight/ui/kit";

type Role = "owner" | "manager" | "marketer" | "packer";
type InviteRole = Exclude<Role, "owner">;
type Member = { userId: string; name: string; email: string; role: Role; permissions: string[]; totp: boolean };
type Invite = { id: string; role: Role; permissions: string[]; note: string | null; expiresAt: string };
type Data = { members: Member[]; invites: Invite[]; all: string[]; require2fa: boolean };
type LogItem = { at: string; userId: string | null; name: string | null; kind: "audit" | "order" | "product"; action: string; ref: string | null; meta: Record<string, unknown> };
const DEFAULTS: Record<InviteRole, string[]> = { manager: ["orders", "products", "reviews", "support"], marketer: ["analytics", "reviews", "site"], packer: ["shipping"] };

export function TeamScreen({ me }: { me: Me }) {
  const d = useDict();
  const t = d.app.team;
  const f = useFormat();
  const [flash, show] = useFlash();
  const [data, setData] = useState<Data | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [role, setRole] = useState<InviteRole>("manager");
  const [perms, setPerms] = useState<string[]>(DEFAULTS.manager);
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Data>("/team");
    if (r.ok) setData(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data) return null;
  const perm = (p: string) => (t.perms as Record<string, string>)[p] ?? p;

  const toggle = async (m: Member, p: string) => {
    const next = m.permissions.includes(p) ? m.permissions.filter((x) => x !== p) : [...m.permissions, p];
    // Optimistic: the checkbox changes at once; the server result is re-read afterwards.
    setData((cur) => (cur ? { ...cur, members: cur.members.map((x) => (x.userId === m.userId ? { ...x, permissions: next } : x)) } : cur));
    const r = await api(`/team/members/${m.userId}`, { method: "PATCH", body: { permissions: next } });
    if (r.ok) show(t.saved);
    else playSound("error");
    void load();
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api<{ token: string }>("/team/invites", { method: "POST", body: { role, permissions: perms, ...(note.trim() ? { note } : {}) } });
    if (!r.ok) return playSound("error");
    playSound("success");
    setLink(`${location.origin}/app/?invite=${r.data.token}`);
    setNote("");
    void load();
  };

  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <p className="ok-muted">{t.lead}</p>
      <Panel>
        <div className="ok-table-wrap">
          <table className="ok-table">
            <thead>
              <tr>
                <th scope="col" />
                {data.all.map((p) => <th key={p} scope="col">{perm(p)}</th>)}
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.userId}>
                  <th scope="row">
                    <b>{m.name}{m.userId === me.id ? ` (${t.you})` : ""}</b>
                    <small>{t.roles[m.role]} · {m.email} · <span data-bad={!m.totp && data.require2fa || undefined}>{m.totp ? t.twoFa : t.noTwoFa}</span></small>
                  </th>
                  {data.all.map((p) => (
                    <td key={p}>
                      <input type="checkbox" checked={m.permissions.includes(p)} disabled={m.role === "owner"} title={m.role === "owner" ? t.owner : undefined} aria-label={`${m.name}: ${perm(p)}`} onChange={() => toggle(m, p)} />
                    </td>
                  ))}
                  <td>
                    {m.role !== "owner" &&
                      (confirm === m.userId ? (
                        <span className="ok-actions">
                          <button type="button" className="btn btn-sm" onClick={async () => { await api(`/team/members/${m.userId}`, { method: "DELETE" }); setConfirm(null); void load(); }}>{t.yes}</button>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>{t.no}</button>
                        </span>
                      ) : (
                        <button type="button" className="ok-link ok-danger" onClick={() => setConfirm(m.userId)} aria-label={fmt(t.removeConfirm, { name: m.name })}><Icon name="close" size={15} /></button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title={t.invite}>
        <form className="grid gap-3" onSubmit={create}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.role}>
              {(p) => (
                <select {...p} className="input" value={role} onChange={(e) => { const r = e.target.value as InviteRole; setRole(r); setPerms(DEFAULTS[r]); }}>
                  <option value="manager">{t.roles.manager}</option>
                  <option value="marketer">{t.roles.marketer}</option>
                  <option value="packer">{t.roles.packer}</option>
                </select>
              )}
            </Field>
            <Field label={t.note}>{(p) => <input {...p} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          </div>
          <div className="ok-chips" role="group" aria-label={t.permsLabel}>
            {data.all.map((p) => (
              <button key={p} type="button" className="ok-chip" aria-pressed={perms.includes(p)} onClick={() => setPerms((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]))}>{perm(p)}</button>
            ))}
          </div>
          <button className="btn btn-sm" type="submit" style={{ justifySelf: "start" }}><Icon name="link" size={15} />{t.create}</button>
        </form>
        {link && (
          <div className="ok-topup">
            <b>{t.link}</b>
            <code className="app-key">{link}</code>
            <p className="ok-muted">{t.linkNote}</p>
            <button type="button" className="btn btn-sm btn-secondary" style={{ justifySelf: "start" }} onClick={() => void navigator.clipboard.writeText(link).then(() => show(d.app.billing.copied))}>{d.app.billing.copy}</button>
          </div>
        )}
        {data.invites.length > 0 && (
          <>
            <div className="ok-sub">{t.pending}</div>
            <ul className="ok-list">
              {data.invites.map((i) => (
                <li key={i.id}>
                  <span className="ok-grow"><b>{t.roles[i.role]}{i.note ? ` · ${i.note}` : ""}</b><small>{i.permissions.map(perm).join(", ")} · {fmt(t.until, { date: f.date(new Date(i.expiresAt).getTime()) })}</small></span>
                  <button type="button" className="ok-link" onClick={async () => { await api(`/team/invites/${i.id}`, { method: "DELETE" }); void load(); }}>{t.revoke}</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
      {me.role === "owner" && (
        <Panel title={t.securityTitle}>
          <Toggle
            checked={data.require2fa}
            onChange={async (v) => {
              const r = await api("/team/settings", { method: "PATCH", body: { require2fa: v } });
              if (!r.ok) {
                playSound("error");
                return show(r.error === "own_2fa_needed" ? t.own2fa : d.app.auth.errors.server_error);
              }
              show(v ? t.require2faOn : t.saved);
              void load();
            }}
            label={t.require2fa}
          />
          <p className="ok-muted">{t.require2faHint}</p>
        </Panel>
      )}
      {me.role === "owner" && <TeamLog members={data.members} />}
      {flash}
    </div>
  );
}

/** «Журнал дій» (owner): who did what — actions, order changes, product changes; by person, in pages. */
function TeamLog({ members }: { members: Member[] }) {
  const d = useDict();
  const t = d.app.team;
  const f = useFormat();
  const [who, setWho] = useState("");
  const [items, setItems] = useState<LogItem[]>([]);
  const [more, setMore] = useState(false);
  const load = useCallback(async (before?: string) => {
    const q = new URLSearchParams({ ...(who ? { user: who } : {}), ...(before ? { before } : {}) });
    const r = await api<{ items: LogItem[]; more: boolean }>(`/team/log?${q}`);
    if (!r.ok) return;
    setItems((cur) => (before ? [...cur, ...r.data.items] : r.data.items));
    setMore(r.data.more);
  }, [who]);
  useEffect(() => {
    void load();
  }, [load]);
  const text = (x: LogItem) => {
    if (x.kind === "order") {
      const what = x.action === "status" ? fmt(t.log.status, { s: (d.ok.orders.status as Record<string, string>)[String(x.meta.status)] ?? String(x.meta.status ?? "") }) : (t.log.orderKinds as Record<string, string>)[x.action] ?? x.action;
      return fmt(t.log.order, { n: x.ref ?? "", what });
    }
    if (x.kind === "product") return fmt(t.log.product, { name: x.ref ?? "", what: (d.app.products.eventKinds as Record<string, string>)[x.action] ?? x.action });
    return (t.log.actions as Record<string, string>)[x.action] ?? x.action;
  };
  return (
    <Panel title={t.logTitle}>
      <label className="ok-select" style={{ justifySelf: "start" }}>
        <span className="sr-only">{t.logWho}</span>
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">{t.logAll}</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
        </select>
      </label>
      {items.length === 0 ? (
        <p className="ok-muted">{t.logEmpty}</p>
      ) : (
        <ol className="app-timeline">
          {items.map((x, i) => (
            <li key={`${x.at}${i}`}>
              <span className="app-timeline-what"><b>{x.name ?? t.log.someone}</b> {text(x)}</span>
              <small className="ok-muted">{f.dateTime(new Date(x.at).getTime())}</small>
            </li>
          ))}
        </ol>
      )}
      {more && <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: "start" }} onClick={() => load(items[items.length - 1]!.at)}>{t.logMore}</button>}
      <p className="ok-muted">{t.logHint}</p>
    </Panel>
  );
}
