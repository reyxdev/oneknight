"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, hasAuthHint, type Me } from "@/lib/api";
import { useDict } from "@/i18n/provider";
import { loadPortfolioSettings } from "./settings";

/**
 * Hidden preview (answer 474): everyone gets the «скоро» page; a signed-in admin gets the new site instead.
 * Once the owner turns on «Показати новий сайт усім» in the admin (answer 446), everyone gets it.
 * Checked after load, so the static page stays the same for search engines until the site is rebuilt as «portfolio».
 */
export function PreviewGate({ soon, children }: { soon: ReactNode; children: ReactNode }) {
  const t = useDict().pf;
  const [admin, setAdmin] = useState(false);
  const [live, setLive] = useState(false);
  useEffect(() => {
    void loadPortfolioSettings().then((s) => {
      if (!s.live) return;
      setLive(true);
      document.title = t.meta.title;
    });
    if (!hasAuthHint()) return;
    void api<Me>("/auth/me").then((r) => {
      if (r.ok && r.data.isAdmin) {
        setAdmin(true);
        document.title = t.meta.title;
      }
    });
  }, [t.meta.title]);
  if (live) return children;
  if (!admin) return soon;
  return (
    <>
      <p className="pf-preview" role="status">{t.preview}</p>
      {children}
    </>
  );
}
