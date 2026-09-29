"use client";

import { usePathname } from "next/navigation";
import { useLang } from "@/i18n/provider";
import type { Lang } from "@/config";

/** Plain links: crawlable, works without JS. Keeps the current path. */
export function LanguageSwitcher() {
  const lang = useLang();
  const pathname = usePathname() ?? "/";
  const swap = (target: Lang) => {
    const path = pathname.replace(/^\/en(?=\/|$)/, "") || "/";
    return target === "uk" ? path : `/en${path === "/" ? "/" : path}`;
  };
  return (
    <div className="inline-flex rounded-full bg-surface-2 p-1 text-sm font-semibold" role="group" aria-label="Language">
      {(["uk", "en"] as const).map((l) => (
        <a
          key={l}
          href={swap(l)}
          hrefLang={l}
          lang={l}
          aria-current={lang === l ? "true" : undefined}
          data-sound="toggle"
          className="grid min-h-8 min-w-10 place-items-center rounded-full px-2 uppercase transition-colors duration-150 aria-[current=true]:bg-surface aria-[current=true]:shadow-sm"
        >
          {l}
        </a>
      ))}
    </div>
  );
}
