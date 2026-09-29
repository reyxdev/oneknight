"use client";

import { useEffect, useRef, useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Toggle";
import { api } from "@/lib/api";
import { Empty, Panel, useFormat } from "@/features/oneknight/ui/kit";
import { useBilling } from "./Billing";
import { useSites } from "./SiteScreen";

type Status = "pending" | "published" | "trash";
type Review = { id: string; name: string; rating: number; text: string; verified: boolean; consent: boolean; product: { id: string; name: string | null } | null; photo: string | null; videoUrl: string | null; date: string; status: Status; trashedAt: string | null; domain: string };

/** Draws a 1080×1080 social creative from a review, fully in the browser, and offers it as a PNG. */
function drawCreative(canvas: HTMLCanvasElement, r: Review) {
  const c = canvas.getContext("2d")!;
  const S = 1080;
  canvas.width = S;
  canvas.height = S;
  const g = c.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, "#26364a");
  g.addColorStop(1, "#0b0e13");
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  const font = getComputedStyle(document.documentElement).getPropertyValue("--font-geologica") || "sans-serif";
  c.fillStyle = "#f2c14e";
  c.font = `700 64px ${font}`;
  c.fillText("★".repeat(r.rating) + "☆".repeat(5 - r.rating), 96, 200);
  c.fillStyle = "#ffffff";
  c.font = `800 60px ${font}`;
  const words = `«${r.text}»`.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (c.measureText(t).width > S - 192 && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 8);
  if (lines.length > 8) shown[7] = `${shown[7]!.replace(/\s+\S*$/, "")}…»`;
  shown.forEach((l, i) => c.fillText(l, 96, 330 + i * 78));
  c.font = `600 40px ${font}`;
  c.fillStyle = "rgba(255,255,255,0.85)";
  c.fillText(`${r.name}${r.product?.name ? ` · ${r.product.name}` : ""}`, 96, S - 170);
  c.font = `700 34px ${font}`;
  c.fillStyle = "#8fa6bc";
  c.fillText(r.domain.toUpperCase(), 96, S - 104);
}

function Creative({ r }: { r: Review }) {
  const t = useDict().app.reviews;
  const ref = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    drawCreative(ref.current, r);
    setUrl(ref.current.toDataURL("image/png"));
  }, [r]);
  return (
    <div className="ok-creative-wrap">
      <canvas ref={ref} className="app-creative" aria-label={t.creative} />
      <p className="ok-muted">{t.creativeNote}</p>
      {url && <a className="btn btn-sm" href={url} download={`review-${r.id.slice(0, 8)}.png`}><Icon name="image" size={15} />{t.download}</a>}
    </div>
  );
}

export function ReviewsScreen({ goModules }: { goModules: () => void }) {
  const d = useDict();
  const t = d.app.reviews;
  const f = useFormat();
  const { data: billing } = useBilling();
  const { sites, load: reloadSites } = useSites();
  const [tab, setTab] = useState<Status>("pending");
  const [rows, setRows] = useState<Review[] | null>(null);
  const [creative, setCreative] = useState<string | null>(null);
  const active = !!billing?.modules.some((m) => m.id === "reviews");
  // Reload for the tab that is open *now*: bump after an action, cancel stale responses on tab change.
  const [bump, setBump] = useState(0);
  // A different tab never shows the previous tab's rows while loading.
  useEffect(() => setRows(null), [tab]);
  useEffect(() => {
    let live = true;
    void api<Review[]>(`/reviews?status=${tab}`).then((r) => {
      if (live && r.ok) setRows(r.data);
    });
    return () => {
      live = false;
    };
  }, [tab, bump]);
  const act = async (id: string, a: string) => {
    await api(`/reviews/${id}/${a}`, { method: "POST", body: {} });
    setBump((n) => n + 1);
  };
  if (!billing) return null;
  if (!active)
    return (
      <div className="ok-screen">
        <div className="ok-h"><h3>{t.title}</h3></div>
        <Panel>
          <p className="ok-muted">{t.needModule}</p>
          <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} onClick={goModules}><Icon name="puzzle" size={15} />{t.toModules}</button>
        </Panel>
      </div>
    );
  const site = sites?.[0] as ({ id: string; reviewModeration?: "off" | "manual" } | undefined);
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      {site && (
        <Panel title={t.moderation}>
          <Segmented
            label={t.moderation}
            value={site.reviewModeration ?? "manual"}
            onChange={async (v) => { await api(`/reviews/settings/${site.id}`, { method: "PATCH", body: { moderation: v } }); void reloadSites(); }}
            options={[{ v: "manual", t: t.manual }, { v: "off", t: t.off }]}
          />
          <p className="ok-muted">{(site.reviewModeration ?? "manual") === "manual" ? t.manualText : t.offText}</p>
        </Panel>
      )}
      <div className="ok-chips" role="tablist" aria-label={t.title}>
        {(["pending", "published", "trash"] as const).map((k) => (
          <button key={k} type="button" role="tab" className="ok-chip" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{t.tabs[k]}</button>
        ))}
      </div>
      {tab === "trash" && <p className="ok-muted">{t.trashNote}</p>}
      <Panel>
        {rows && rows.length === 0 ? (
          <Empty icon="star" text={t.empty[tab]} />
        ) : (
          <ul className="ok-reviews">
            {(rows ?? []).map((r) => (
              <li key={r.id} className="ok-review">
                <header>
                  <b>{r.name}</b>
                  <span className="ok-stars" aria-label={`${r.rating} / 5`}>
                    {Array.from({ length: 5 }, (_, i) => <Icon key={i} name="star" size={14} style={{ fill: i < r.rating ? "currentColor" : "none" }} />)}
                  </span>
                  <small className="ok-muted">{f.ago(new Date(r.date).getTime())}</small>
                </header>
                <p>{r.text}</p>
                {r.photo && <a href={r.photo} target="_blank" rel="noopener"><img className="app-review-photo" src={r.photo} alt="" loading="lazy" /></a>}
                <div className="ok-tags">
                  {r.verified && <span className="ok-tag"><Icon name="shield" size={13} />{t.verified}</span>}
                  {r.product?.name && <span className="ok-tag"><Icon name="box" size={13} />{r.product.name}</span>}
                  <span className="ok-tag" data-bad={!r.consent}><Icon name={r.consent ? "check" : "close"} size={13} />{r.consent ? t.consent : t.noConsent}</span>
                  {r.videoUrl && <a className="ok-tag" href={r.videoUrl} target="_blank" rel="noopener nofollow"><Icon name="play" size={13} />{t.video}</a>}
                  {r.status === "trash" && r.trashedAt && <span className="ok-tag">{fmt(t.daysLeft, { n: Math.max(0, 30 - Math.floor((Date.now() - new Date(r.trashedAt).getTime()) / 86_400_000)) })}</span>}
                </div>
                <div className="ok-actions">
                  {r.status === "pending" && (
                    <>
                      <button type="button" className="btn btn-sm" disabled={!r.consent} onClick={() => act(r.id, "approve")}><Icon name="check" size={16} />{t.approve}</button>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => act(r.id, "reject")}>{t.reject}</button>
                    </>
                  )}
                  {r.status === "published" && (
                    <>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => setCreative(creative === r.id ? null : r.id)}><Icon name="image" size={16} />{t.creative}</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => act(r.id, "reject")}>{t.reject}</button>
                    </>
                  )}
                  {r.status === "trash" && (
                    <>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => act(r.id, "restore")}>{t.restore}</button>
                      <button type="button" className="btn btn-sm btn-ghost ok-danger" onClick={() => act(r.id, "delete")}><Icon name="trash" size={16} />{t.delete}</button>
                    </>
                  )}
                </div>
                {creative === r.id && <Creative r={r} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
