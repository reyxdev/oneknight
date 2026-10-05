import type { Metadata } from "next";
import { config } from "@/config";
import { getDict } from "@/i18n";
import { StatusPage } from "@/features/page/StatusPage";
import { ComingSoon } from "@/features/soon/ComingSoon";

const t = getDict("uk").statusPage.meta;
// Hidden while the panel is closed and the new portfolio is built (owner's answers 1–3, 348): the «скоро» page, not indexed.
const hidden = config.siteMode !== "full";
export const metadata: Metadata = hidden
  ? { title: getDict("uk").soon.meta.title, robots: { index: false, follow: false } }
  : { title: t.title, description: t.description, alternates: { canonical: "/status/" } };

export default function Page() {
  return hidden ? <ComingSoon lang="uk" /> : <StatusPage />;
}
