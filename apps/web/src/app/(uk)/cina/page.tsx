import type { Metadata } from "next";
import { config } from "@/config";
import { getDict } from "@/i18n";
import { ComingSoon } from "@/features/soon/ComingSoon";
import { PricePage } from "@/features/portfolio/PortfolioHome";
import { PreviewGate } from "@/features/portfolio/PreviewGate";

const lang = "uk" as const;
const soon = config.siteMode === "soon";
const t = getDict(lang).pf.pages.cina;
export const metadata: Metadata = soon
  ? { title: getDict(lang).soon.meta.title, robots: { index: false, follow: false } }
  : { title: t.title, description: t.description, alternates: { canonical: "/cina/", languages: { uk: "/cina/", en: "/en/cina/" } } };

export default function Page() {
  return soon ? (
    <PreviewGate soon={<ComingSoon lang={lang} />}>
      <PricePage lang={lang} />
    </PreviewGate>
  ) : (
    <PricePage lang={lang} />
  );
}
