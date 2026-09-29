import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/globals.css";
import { RootShell } from "@/components/global/RootShell";
import { siteMetadata } from "@/lib/seo";
import { homeChapters } from "@/features/page/chapters";

export const metadata: Metadata = siteMetadata("uk");

export default function Layout({ children }: { children: ReactNode }) {
  return <RootShell lang="uk" chapters={homeChapters}>{children}</RootShell>;
}
