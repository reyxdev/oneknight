import type { Metadata } from "next";
import { config } from "@/config";
import { getDict } from "@/i18n";
import { ComingSoon } from "@/features/soon/ComingSoon";
import { ServicePage } from "@/features/portfolio/PortfolioHome";
import { PreviewGate } from "@/features/portfolio/PreviewGate";

const lang = "uk" as const;
const slug = "internet-magazyn";
const soon = config.siteMode === "soon";
const t = getDict(lang).pf.services.items.find((x) => x.slug === slug)!;
export const metadata: Metadata = soon
  ? { title: getDict(lang).soon.meta.title, robots: { index: false, follow: false } }
  : { title: t.title, description: t.description, alternates: { canonical: `/${slug}/`, languages: { uk: `/${slug}/`, en: `/en/${slug}/` } } };

export default function Page() {
  return soon ? (
    <PreviewGate soon={<ComingSoon lang={lang} />}>
      <ServicePage lang={lang} slug={slug} />
    </PreviewGate>
  ) : (
    <ServicePage lang={lang} slug={slug} />
  );
}
