"use client";

import { useEffect, useState } from "react";
import { useDict } from "@/i18n/provider";
import { Segmented } from "@/components/ui/Toggle";
import { Icon } from "@/components/ui/Icon";
import { playSound } from "@/lib/sound";

export function WebsitesDemo() {
  const t = useDict().services.websites;
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [cart, setCart] = useState<number[]>([]);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 2600);
    return () => clearTimeout(id);
  }, [done]);

  return (
    <div className="demo demo-web">
      <Segmented
        label={t.device}
        value={device}
        onChange={setDevice}
        options={[
          { v: "desktop", t: t.desktop },
          { v: "phone", t: t.phone },
        ]}
      />
      <div className="webframe" data-device={device}>
        <div className="webframe-chrome" aria-hidden="true">
          <i /><i /><i />
          <span>vash-biznes.ua</span>
        </div>
        <div className="webframe-page">
          <div className="webpage-head">
            <b>{t.siteName}</b>
            <button type="button" className="webpage-cart" aria-label={`${t.cart}: ${cart.length}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              <Icon name="cart" size={18} />
              {cart.length > 0 && <span key={cart.length} className="webpage-badge">{cart.length}</span>}
            </button>
            {open && (
              <div className="webpage-pop" role="dialog" aria-label={t.cart}>
                {cart.length === 0 ? (
                  <p>{t.empty}</p>
                ) : (
                  <>
                    <p><b>{cart.length}</b> {t.items}</p>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setCart([]);
                        setOpen(false);
                        setDone(true);
                        playSound("success");
                      }}
                    >
                      {t.checkout}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="webpage-hero">
            <h4>{t.heroTitle}</h4>
            <p>{t.heroText}</p>
          </div>
          <div className="webpage-grid">
            {t.products.map((name, i) => {
              const inCart = cart.includes(i);
              return (
                <div key={name} className="webpage-item">
                  <div className="webpage-thumb" style={{ ["--h" as string]: 200 + i * 28 }} />
                  <b>{name}</b>
                  <button type="button" className="btn btn-sm btn-secondary" aria-pressed={inCart} onClick={() => setCart((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))}>
                    {inCart ? "✓" : t.buy}
                  </button>
                </div>
              );
            })}
          </div>
          {done && (
            <p className="webpage-done" role="status">
              <Icon name="check" size={16} /> {t.done}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
