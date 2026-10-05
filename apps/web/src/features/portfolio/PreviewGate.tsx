"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, hasAuthHint, type Me } from "@/lib/api";
import { useDict } from "@/i18n/provider";

/**
 * Hidden preview (answer 474): everyone gets the «скоро» page; a signed-in admin gets the new site instead.
 * Checked after load, so the static page stays the same for all visitors and search engines.
 */
export function PreviewGate({ soon, children }: { soon: ReactNode; children: ReactNode }) {
  const t = useDict().pf;
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (!hasAuthHint()) return;
    void api<Me>("/auth/me").then((r) => {
      if (r.ok && r.data.isAdmin) {
        setAdmin(true);
        document.title = t.meta.title;
      }
    });
  }, [t.meta.title]);
  if (!admin) return soon;
  return (
    <>
      <p className="pf-preview" role="status">{t.preview}</p>
      {children}
    </>
  );
}
