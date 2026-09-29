"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { api, type Me } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, useFlash, useFormat } from "@/features/oneknight/ui/kit";

type Role = "owner" | "manager" | "marketer";
type Member = { userId: string; name: string; email: string; role: Role; permissions: string[]; totp: boolean };
type Invite = { id: string; role: Role; permissions: string[]; note: string | null; expiresAt: string };
type Data = { members: Member[]; invites: Invite[]; all: string[] };
const DEFAULTS: Record<"manager" | "marketer", string[]> = { manager: ["orders", "products", "reviews", "support"], marketer: ["analytics", "reviews", "site"] };

export function TeamScreen({ me }: { me: Me }) {
  const d = useDict();
  const t = d.app.team;
  const f = useFormat();
  const [flash, show] = useFlash();
  const [data, setData] = useState<Data | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [role, setRole] = useState<"manager" | "marketer">("manager");
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
                    <small>{t.roles[m.role]} · {m.email}{m.totp ? ` · ${t.twoFa}` : ""}</small>
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
                <select {...p} className="input" value={role} onChange={(e) => { const r = e.target.value as "manager" | "marketer"; setRole(r); setPerms(DEFAULTS[r]); }}>
                  <option value="manager">{t.roles.manager}</option>
                  <option value="marketer">{t.roles.marketer}</option>
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
      {flash}
    </div>
  );
}
