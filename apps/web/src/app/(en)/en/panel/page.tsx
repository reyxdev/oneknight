import type { Metadata } from "next";
import { getDict } from "@/i18n";
import { PanelPage } from "@/features/page/PanelPage";

const t = getDict("en").panelPage.meta;
export const metadata: Metadata = {
  title: t.title,
  description: t.description,
  alternates: { canonical: "/en/panel/", languages: { uk: "/panel/", en: "/en/panel/" } },
  openGraph: { title: t.title, description: t.description, url: "/en/panel/" },
};

export default function Page() {
  return <PanelPage lang="en" />;
}
