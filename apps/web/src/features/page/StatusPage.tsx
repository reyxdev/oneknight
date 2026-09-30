"use client";

import { useEffect, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { contacts } from "@/data/contacts";

type Summary = {
  services: { service: string; state: "up" | "degraded" | "down" | "unknown"; checkedAt: string | null; days: { day: string; uptime: number | null }[] }[];
  incidents: { id: string; service: string; startedAt: string; endedAt: string | null; note: string | null }[];
};

/** /status: filled from the API on load (the page itself is static), refreshed every minute. */
export function StatusPage() {
  const t = useDict().statusPage;
  const lang = useLang();
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    const load = () =>
      fetch("/api/site/status")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((x: Summary) => { setS(x); setErr(false); })
        .catch(() => setErr(true));
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);
  const locale = lang === "uk" ? "uk-UA" : "en-GB";
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const ago = (iso: string) => {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-min, "minute");
  };
  const name = (k: string) => (t.services as Record<string, string>)[k] ?? k;
  return (
    <section className="section status-page" aria-labelledby="status-title">
      <div className="wrap">
        <h1 id="status-title" className="h1">{t.title}</h1>
        <p className="lead">{t.lead}</p>
        {err && <p className="card p-4" role="alert">{t.loadError} <a className="underline underline-offset-4" href={contacts.telegram.url} target="_blank" rel="noopener">Telegram</a></p>}
        {s && (
          <>
            <ul className="status-list">
              {s.services.map((x) => (
                <li key={x.service} data-state={x.state}>
                  <div className="status-row">
                    <b>{name(x.service)}</b>
                    <span className="status-state">{t.states[x.state]}</span>
                  </div>
                  <div className="status-bars" role="img" aria-label={`${name(x.service)}: 90`}>
                    {x.days.map((d) => (
                      <i key={d.day} data-level={d.uptime === null ? "none" : d.uptime >= 99.5 ? "ok" : d.uptime >= 95 ? "warn" : "bad"} title={d.uptime === null ? `${d.day}: ${t.noData}` : fmt(t.uptime, { day: d.day, p: d.uptime })} />
                    ))}
                  </div>
                  <div className="status-axis small"><span>{t.days90}</span><span>{x.checkedAt ? fmt(t.checked, { ago: ago(x.checkedAt) }) : ""}</span><span>{t.today}</span></div>
                </li>
              ))}
            </ul>
            <p className="small">{t.carriersNote}</p>
            <h2 className="h3 mt-10 mb-4">{t.incidents}</h2>
            {s.incidents.length === 0 ? (
              <p className="small">{t.noIncidents}</p>
            ) : (
              <ul className="status-incidents">
                {s.incidents.map((i) => (
                  <li key={i.id}>
                    <b>{name(i.service)}</b>
                    <span className="small">{when(i.startedAt)} — {i.endedAt ? when(i.endedAt) : t.ongoing}</span>
                    {i.note && <p>{i.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
