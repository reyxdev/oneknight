import type { Metadata } from "next";
import { config } from "@/config";
import { HomePage } from "@/features/page/HomePage";
import { ComingSoon } from "@/features/soon/ComingSoon";
import { getDict } from "@/i18n";

const soon = config.siteMode === "soon";
// While the new portfolio is built the home page is the «скоро» page and stays out of search (answer 354).
export const metadata: Metadata = soon ? { title: getDict("uk").soon.meta.title, description: getDict("uk").soon.meta.description, robots: { index: false, follow: false } } : {};

export default function Page() {
  return soon ? <ComingSoon lang="uk" /> : <HomePage lang="uk" />;
}
