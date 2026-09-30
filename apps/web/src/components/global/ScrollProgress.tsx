"use client";

import { usePathname } from "next/navigation";
import type { Dict } from "@/i18n";

/** Static markup: the runtime writes --page-p on <html> and marks the current chapter. */
export const CHAPTERS = ["hero", "chaos", "funnel", "services", "pricing", "template", "work", "oneknight", "playground", "modules", "offer", "trust", "process", "support", "about", "contacts"] as const;
export type ChapterId = (typeof CHAPTERS)[number];

export function ScrollProgress({ dict, present }: { dict: Dict; present: readonly ChapterId[] }) {
  // The chapter rail belongs to the home page; other pages keep only the progress bar.
  const path = usePathname() ?? "/";
  const home = path === "/" || path === "/en" || path === "/en/";
  return (
    <>
      <div className="ok-progress" role="progressbar" aria-label={dict.a11y.progress} aria-hidden="true">
        <span />
      </div>
      {home && <nav className="ok-rail" aria-label={dict.a11y.chapters}>
        {present.map((id) => (
          <a key={id} href={`#${id}`} aria-current="false">
            <span>{dict.chapters[id]}</span>
          </a>
        ))}
      </nav>}
    </>
  );
}
