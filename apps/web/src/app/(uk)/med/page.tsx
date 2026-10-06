import type { Metadata } from "next";
import { ComingSoon } from "@/features/soon/ComingSoon";
import { PortfolioShell } from "@/features/portfolio/PortfolioHome";
import { PreviewGate } from "@/features/portfolio/PreviewGate";
import { HoneyLab } from "@/features/honey/HoneyLab";

// The honey sandbox for the owner (answer 49): never indexed, only the admin sees it.
export const metadata: Metadata = { title: "Пісочниця: мед у літерах", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <PreviewGate soon={<ComingSoon lang="uk" />}>
      <PortfolioShell>
        <section className="pf-section pf-page-head">
          <div className="pf-wrap">
            <h1 className="pf-h1 pf-page-h1">Пісочниця: мед у літерах</h1>
            <p className="pf-lead">Крутіть повзунки, доки не скажете «оце воно». Потім «Скопіювати налаштування» й надішліть мені.</p>
          </div>
          <HoneyLab />
        </section>
      </PortfolioShell>
    </PreviewGate>
  );
}
