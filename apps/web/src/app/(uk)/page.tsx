import type { Metadata } from "next";
import { config } from "@/config";
import { HomePage } from "@/features/page/HomePage";
import { ComingSoon } from "@/features/soon/ComingSoon";
import { PortfolioHome } from "@/features/portfolio/PortfolioHome";
import { PreviewGate } from "@/features/portfolio/PreviewGate";
import { getDict } from "@/i18n";

const soon = config.siteMode === "soon";
// While the new portfolio is built the home page is the «скоро» page and stays out of search (answer 354).
export const metadata: Metadata = soon ? { title: getDict("uk").soon.meta.title, description: getDict("uk").soon.meta.description, robots: { index: false, follow: false } } : {};

export default function Page() {
  // The admin sees the new portfolio while it is built (answer 474).
  return soon ? (
    <PreviewGate soon={<ComingSoon lang="uk" />}>
      <PortfolioHome lang="uk" />
    </PreviewGate>
  ) : (
    <HomePage lang="uk" />
  );
}
