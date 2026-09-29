"use client";

import { useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { config } from "@/config";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Toggle";
import { useClient, useOkState } from "../state";
import { Empty, Panel, useFormat } from "../ui/kit";
import type { Review, ReviewStatus } from "@oneknight/domain";

const DAY = 86_400_000;

export function Reviews() {
  const t = useDict().ok.reviews;
  const s = useOkState();
  const client = useClient();
  const f = useFormat();
  const [tab, setTab] = useState<ReviewStatus>("pending");
  const [creative, setCreative] = useState<Review | null>(null);
  const list = s.reviews.filter((r) => r.status === tab);
  const product = (id: string | null) => s.products.find((p) => p.id === id)?.name;

  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <Panel title={t.moderation}>
        <Segmented
          label={t.moderation}
          value={s.moderation}
          onChange={(v) => client.setModeration(v)}
          options={[
            { v: "manual", t: t.modManual.split(":")[0]! },
            { v: "off", t: t.modOff.split(":")[0]! },
          ]}
        />
        <p className="ok-muted">{s.moderation === "manual" ? t.modManual : t.modOff}</p>
      </Panel>
      <div className="ok-chips" role="tablist" aria-label={t.title}>
        {(["pending", "published", "trash"] as const).map((k) => (
          <button key={k} type="button" role="tab" className="ok-chip" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>
            {t.tabs[k]}<span className="num">{s.reviews.filter((r) => r.status === k).length}</span>
          </button>
        ))}
      </div>
      {tab === "trash" && <p className="ok-muted">{fmt(t.trashNote, { days: config.reviews.trashRetentionDays })}</p>}
      <Panel>
        {list.length === 0 ? (
          <Empty icon="star" text={t.empty[tab]} />
        ) : (
          <ul className="ok-reviews">
            {list.map((r) => (
              <li key={r.id} className="ok-review">
                <header>
                  <b>{r.author}</b>
                  <span className="ok-stars" aria-label={`${r.rating} / 5`}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <Icon key={i} name="star" size={14} style={{ fill: i < r.rating ? "currentColor" : "none" }} />
                    ))}
                  </span>
                  <small className="ok-muted">{f.ago(r.createdAt)}</small>
                </header>
                <p>{r.text}</p>
                <div className="ok-tags">
                  {product(r.productId) && <span className="ok-tag"><Icon name="box" size={13} />{product(r.productId)}</span>}
                  <span className="ok-tag" data-bad={!r.consent}><Icon name={r.consent ? "check" : "close"} size={13} />{r.consent ? t.consent : t.noConsent}</span>
                  {r.hasPhoto && <span className="ok-tag"><Icon name="image" size={13} />{t.photo}</span>}
                  {r.status === "trash" && r.trashedAt && (
                    <span className="ok-tag">{fmt(t.daysLeft, { n: Math.max(0, config.reviews.trashRetentionDays - Math.floor((Date.now() - r.trashedAt) / DAY)) })}</span>
                  )}
                </div>
                <div className="ok-actions">
                  {r.status === "pending" && (
                    <>
                      <button type="button" className="btn btn-sm" data-sound="success" disabled={!r.consent} onClick={() => client.moderateReview(r.id, "approve")}><Icon name="check" size={16} />{t.approve}</button>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => client.moderateReview(r.id, "reject")}>{t.reject}</button>
                    </>
                  )}
                  {r.status === "published" && (
                    <>
                      {r.rating >= 4 && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setCreative(r)}><Icon name="image" size={16} />{t.creative}</button>}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => client.moderateReview(r.id, "reject")}>{t.reject}</button>
                    </>
                  )}
                  {r.status === "trash" && (
                    <>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => client.moderateReview(r.id, "restore")}>{t.restore}</button>
                      <button type="button" className="btn btn-sm btn-ghost ok-danger" onClick={() => client.moderateReview(r.id, "delete")}><Icon name="trash" size={16} />{t.delete}</button>
                    </>
                  )}
                </div>
                {creative?.id === r.id && (
                  <div className="ok-creative-wrap">
                    <div className="ok-creative" data-accent={s.customization.accent}>
                      <span className="ok-stars">{"★★★★★".slice(0, r.rating)}</span>
                      <q>{r.text}</q>
                      <span>{r.author}{product(r.productId) ? ` · ${product(r.productId)}` : ""}</span>
                      <b>{s.sites.find((x) => x.id === s.activeSiteId)?.domain}</b>
                    </div>
                    <p className="ok-muted">{t.creativeNote}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p className="ok-muted"><Icon name="clock" size={14} /> {t.autoAsk} <span className="pill">{t.soon}</span></p>
    </div>
  );
}
