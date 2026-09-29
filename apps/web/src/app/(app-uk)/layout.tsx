import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/globals.css";
import { AppShell } from "@/components/global/AppShell";
import { getDict } from "@/i18n";

export const metadata: Metadata = { title: getDict("uk").app.title, robots: { index: false, follow: false } };

export default function Layout({ children }: { children: ReactNode }) {
  return <AppShell lang="uk">{children}</AppShell>;
}
