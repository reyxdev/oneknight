"use client";

import { useRef, useState, type PointerEvent } from "react";
import { karpatu } from "@/content/karpatu";
import { useDict } from "@/i18n/provider";
import { Segmented } from "@/components/ui/Toggle";
import { Icon } from "@/components/ui/Icon";

type Device = "desktop" | "mobile";
const base = "/case/karpatu";

function Shot({ device, stop, eager }: { device: Device; stop: string; eager: boolean }) {
  const d = device === "desktop";
  const pre = d ? "d" : "m";
  const [w1, w2] = d ? [960, 1440] : [390, 780];
  return (
    <picture>
      <source type="image/avif" srcSet={`${base}/${pre}-${stop}-${w1}.avif ${w1}w, ${base}/${pre}-${stop}-${w2}.avif ${w2}w`} sizes={d ? "(min-width: 1024px) 60vw, 92vw" : "300px"} />
      <img
        src={`${base}/${pre}-${stop}-${w1}.webp`}
        srcSet={`${base}/${pre}-${stop}-${w1}.webp ${w1}w, ${base}/${pre}-${stop}-${w2}.webp ${w2}w`}
        sizes={d ? "(min-width: 1024px) 60vw, 92vw" : "300px"}
        width={d ? 1440 : 780}
        height={d ? 900 : 1688}
        alt=""
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
      />
    </picture>
  );
}

export function WebsitePreview() {
  const t = useDict().karpatu;
  const [device, setDevice] = useState<Device>("desktop");
  const [i, setI] = useState(0);
  const stops = karpatu.shots[device];
  const idx = Math.min(i, stops.length - 1);
  const drag = useRef<{ x: number; id: number } | null>(null);

  const go = (d: number) => setI((v) => (Math.min(v, stops.length - 1) + d + stops.length) % stops.length);

  const onDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, id: e.pointerId };
  };
  const onUp = (e: PointerEvent) => {
    const s = drag.current;
    drag.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  };

  return (
    <div className="kp-preview">
      <div className="kp-bar">
        <Segmented
          label={t.device}
          value={device}
          onChange={(v) => setDevice(v)}
          options={[
            { v: "desktop", t: t.desktop },
            { v: "mobile", t: t.mobile },
          ]}
        />
        <a className="btn btn-secondary btn-sm" href={karpatu.url} target="_blank" rel="noopener">
          {t.open}
          <Icon name="arrow" size={16} />
        </a>
      </div>

      <div className="kp-stops" role="tablist" aria-label={t.previewLabel}>
        {stops.map((s, n) => (
          <button key={s} type="button" role="tab" aria-selected={idx === n} onClick={() => setI(n)} data-sound="toggle">
            {t.stops[s as keyof typeof t.stops]}
          </button>
        ))}
      </div>

      <div
        className="kp-device"
        data-device={device}
        data-cursor="drag"
        role="group"
        aria-roledescription="carousel"
        aria-label={`${t.previewLabel}: ${t.stops[stops[idx] as keyof typeof t.stops]}`}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => (drag.current = null)}
      >
        {device === "desktop" && (
          <div className="kp-chrome" aria-hidden="true">
            <i /><i /><i />
            <span>karpatu.shop</span>
          </div>
        )}
        <div className="kp-screen">
          <div className="kp-track" style={{ ["--idx" as string]: idx }}>
            {stops.map((s, n) => (
              <div key={`${device}-${s}`} className="kp-slide" aria-hidden={n !== idx}>
                <Shot device={device} stop={s} eager={n === 0} />
              </div>
            ))}
          </div>
        </div>
        <button type="button" className="kp-nav kp-prev" aria-label={t.prev} onClick={() => go(-1)}>
          <Icon name="arrow" size={18} style={{ transform: "scaleX(-1)" }} />
        </button>
        <button type="button" className="kp-nav kp-next" aria-label={t.next} onClick={() => go(1)}>
          <Icon name="arrow" size={18} />
        </button>
      </div>
      <p className="svc-note">{t.shotsNote}</p>
    </div>
  );
}
