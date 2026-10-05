import type { Metadata } from "next";
import { config } from "@/config";
import { getDict } from "@/i18n";
import { ComingSoon } from "@/features/soon/ComingSoon";
import { TechPage } from "@/features/portfolio/PortfolioHome";
import { PreviewGate } from "@/features/portfolio/PreviewGate";

const soon = config.siteMode === "soon";
const t = getDict("uk").pf.tech;
// Ukrainian only: computer help is for Kuty and around (answers 295, 343).
export const metadata: Metadata = soon
  ? { title: getDict("uk").soon.meta.title, robots: { index: false, follow: false } }
  : { title: t.title, description: t.description, alternates: { canonical: "/tekhnika/" } };

export default function Page() {
  return soon ? (
    <PreviewGate soon={<ComingSoon lang="uk" />}>
      <TechPage />
    </PreviewGate>
  ) : (
    <TechPage />
  );
}
