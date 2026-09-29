import type { Dict } from "@/i18n";

/** Static markup: the runtime writes --page-p on <html> and marks the current chapter. */
export const CHAPTERS = ["hero", "chaos", "funnel", "services", "pricing", "template", "work", "oneknight", "playground", "modules", "offer", "trust", "process", "support", "about", "contacts"] as const;
export type ChapterId = (typeof CHAPTERS)[number];

export function ScrollProgress({ dict, present }: { dict: Dict; present: readonly ChapterId[] }) {
  return (
    <>
      <div className="ok-progress" role="progressbar" aria-label={dict.a11y.progress} aria-hidden="true">
        <span />
      </div>
      <nav className="ok-rail" aria-label={dict.a11y.chapters}>
        {present.map((id) => (
          <a key={id} href={`#${id}`} aria-current="false">
            <span>{dict.chapters[id]}</span>
          </a>
        ))}
      </nav>
    </>
  );
}
