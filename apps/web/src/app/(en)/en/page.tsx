import type { Metadata } from "next";
import { config } from "@/config";
import { HomePage } from "@/features/page/HomePage";
import { ComingSoon } from "@/features/soon/ComingSoon";
import { PortfolioHome } from "@/features/portfolio/PortfolioHome";
import { PreviewGate } from "@/features/portfolio/PreviewGate";
import { getDict } from "@/i18n";

const lang = "en" as const;
const mode = config.siteMode;
const d = getDict(lang);
// «скоро»: out of search (answer 354); «portfolio»: the new site, indexed.
export const metadata: Metadata =
  mode === "soon"
    ? { title: d.soon.meta.title, description: d.soon.meta.description, robots: { index: false, follow: false } }
    : mode === "portfolio"
      ? { title: { absolute: d.pf.meta.title }, description: d.pf.meta.description, alternates: { canonical: "/en/", languages: { uk: "/", en: "/en/" } } }
      : {};

export default function Page() {
  if (mode === "full") return <HomePage lang={lang} />;
  if (mode === "portfolio") return <PortfolioHome lang={lang} />;
  // The admin sees the new portfolio while it is built (answer 474).
  return (
    <PreviewGate soon={<ComingSoon lang={lang} />}>
      <PortfolioHome lang={lang} />
    </PreviewGate>
  );
}
