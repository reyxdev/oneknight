import type { Metadata } from "next";
import { getDict } from "@/i18n";
import { StatusPage } from "@/features/page/StatusPage";

const t = getDict("uk").statusPage.meta;
export const metadata: Metadata = { title: t.title, description: t.description, alternates: { canonical: "/status/", languages: { uk: "/status/", en: "/en/status/" } } };

export default function Page() {
  return <StatusPage />;
}
