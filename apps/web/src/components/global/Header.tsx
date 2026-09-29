"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { navItems } from "@/data/navigation";
import { useDict, useLang } from "@/i18n/provider";
import { withLang } from "@/i18n";
import { useSignedIn } from "@/lib/session";
import { KnightMark } from "./Logo";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { PrefsMenu } from "./PrefsMenu";
import { useModal } from "./ModalProvider";

export function Header() {
  const dict = useDict();
  const lang = useLang();
  const pathname = usePathname() ?? "/";
  const session = useSignedIn();
  const appHref = withLang(lang, "/app/");
  const { openOrder } = useModal();
  const [menu, setMenu] = useState(false);

  const home = withLang(lang, "/");
  const isHome = pathname === "/" || pathname === "/en" || pathname === "/en/";
  const href = (hash: string) => (isHome ? hash : `${home}${hash}`);

  useEffect(() => {
    document.documentElement.classList.toggle("modal-open", menu);
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  const primary = () => {
    setMenu(false);
    if (session) window.location.href = appHref;
    else openOrder("choose");
  };
  const ctaLabel = session ? dict.nav.open : dict.nav.order;

  return (
    <>
      <header className="ok-header">
        <div className="ok-header-bar">
          <a href={home} className="ok-logo" aria-label={dict.a11y.home}>
            <KnightMark size={36} />
          </a>

          <div className="ok-collapsible ok-desktop">
            <nav aria-label={dict.a11y.mainNav}>
              {navItems.map((n) => (
                <a key={n.id} href={href(n.href)} className="ok-nav-link">
                  {dict.nav[n.id]}
                </a>
              ))}
            </nav>
          </div>

          <span className="ok-spacer" />

          <div className="ok-collapsible ok-desktop">
            <div>
              <LanguageSwitcher />
              <PrefsMenu />
              {!session && (
                <a href={appHref} className="btn btn-ghost btn-sm">
                  {dict.nav.login}
                </a>
              )}
            </div>
          </div>

          <button type="button" className="btn btn-sm" data-magnetic data-cursor="link" onClick={primary}>
            {ctaLabel}
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon ok-mobile"
            aria-label={dict.a11y.menu}
            aria-expanded={menu}
            aria-controls="ok-menu"
            onClick={() => setMenu((v) => !v)}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {menu ? <path d="M5 5l12 12M17 5L5 17" /> : <path d="M4 7h14M4 15h14" />}
            </svg>
          </button>
        </div>
      </header>

      <div id="ok-menu" className="ok-menu" data-open={menu} inert={!menu} role="dialog" aria-modal="false" aria-label={dict.a11y.menu}>
        {navItems.map((n) => (
          <a key={n.id} href={href(n.href)} className="big" onClick={() => setMenu(false)}>
            {dict.nav[n.id]}
          </a>
        ))}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <LanguageSwitcher />
          <PrefsMenu />
          {!session && (
            <a href={appHref} className="btn btn-secondary btn-sm">
              {dict.nav.login}
            </a>
          )}
        </div>
        <button type="button" className="btn btn-lg mt-4" onClick={primary}>
          {ctaLabel}
        </button>
      </div>
    </>
  );
}
