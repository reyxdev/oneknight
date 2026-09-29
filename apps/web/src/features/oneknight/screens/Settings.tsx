"use client";

import { useState } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { useOkState } from "../state";
import { Panel, useFormat } from "../ui/kit";
import type { Member, Permission } from "@oneknight/domain";

const PERMS: Permission[] = ["orders", "products", "reviews", "analytics", "site", "modules", "billing", "team"];

export function Settings() {
  const t = useDict().ok.settings;
  const s = useOkState();
  const f = useFormat();
  const [members, setMembers] = useState<Member[]>(s.members);
  const toggle = (id: string, p: Permission) =>
    setMembers((ms) => ms.map((m) => (m.id !== id || m.role === "owner" ? m : { ...m, permissions: m.permissions.includes(p) ? m.permissions.filter((x) => x !== p) : [...m.permissions, p] })));

  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <Panel title={t.team}>
        <div className="ok-table-wrap">
          <table className="ok-table">
            <thead>
              <tr>
                <th scope="col" />
                {PERMS.map((p) => (
                  <th key={p} scope="col">{t.perms[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <th scope="row"><b>{m.name}</b><small>{t.roles[m.role]}</small></th>
                  {PERMS.map((p) => (
                    <td key={p}>
                      <input
                        type="checkbox"
                        checked={m.permissions.includes(p)}
                        disabled={m.role === "owner"}
                        onChange={() => toggle(m.id, p)}
                        aria-label={`${m.name}: ${t.perms[p]}`}
                        title={m.role === "owner" ? t.ownerAll : undefined}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="ok-grid-2">
        <Panel title={t.security}>
          <ul className="ok-list">
            <li><Icon name="shield" size={16} /><span className="ok-grow">{t.twoFa}</span><span className="ok-pill" data-s="done">{t.twoFaOn}</span></li>
            <li><Icon name="lock" size={16} /><span className="ok-grow">{t.sessions}</span><span className="ok-muted">{t.thisDevice}</span></li>
          </ul>
          <div className="ok-sub">{t.history}</div>
          <ul className="ok-list">
            {[0.1, 26, 74].map((h, i) => (
              <li key={h}><span className="ok-grow">{["Chrome · Linux", "Safari · iPhone", "Chrome · Android"][i]}</span><small className="ok-muted">{f.ago(Date.now() - h * 3_600_000)}</small></li>
            ))}
          </ul>
        </Panel>
        <Panel title={t.sites}>
          <ul className="ok-list">
            {s.sites.map((x) => (
              <li key={x.id}><i className="ok-state" data-s="ok" aria-hidden="true" /><span className="ok-grow">{x.domain}</span></li>
            ))}
          </ul>
          <p className="ok-muted">{t.addSite}</p>
        </Panel>
      </div>
    </div>
  );
}
