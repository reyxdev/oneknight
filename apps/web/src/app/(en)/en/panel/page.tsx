import type { Metadata } from "next";
import { config } from "@/config";
import { getDict } from "@/i18n";
import { PanelPage } from "@/features/page/PanelPage";
import { ComingSoon } from "@/features/soon/ComingSoon";

const t = getDict("en").panelPage.meta;
// Hidden while the panel is closed and the new portfolio is built (owner's answers 1–3, 348): the «скоро» page, not indexed.
const hidden = config.siteMode === "soon";
export const metadata: Metadata = hidden
  ? { title: getDict("en").soon.meta.title, robots: { index: false, follow: false } }
  : { title: t.title, description: t.description, alternates: { canonical: "/en/panel/" } };

export default function Page() {
  return hidden ? <ComingSoon lang="en" /> : <PanelPage lang="en" />;
}
