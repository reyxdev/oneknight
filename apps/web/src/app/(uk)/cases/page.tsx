import type { Metadata } from "next";
import { getDict } from "@/i18n";
import { CasesPage } from "@/features/page/CasesPage";

const t = getDict("uk").casesPage.meta;
export const metadata: Metadata = { title: t.title, description: t.description, alternates: { canonical: "/cases/", languages: { uk: "/cases/", en: "/en/cases/" } } };

export default function Page() {
  return <CasesPage lang="uk" />;
}
