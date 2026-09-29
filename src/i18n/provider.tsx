"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Lang } from "@/config";
import type { Dict } from "./uk";

type Ctx = { lang: Lang; dict: Dict };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ lang, dict, children }: Ctx & { children: ReactNode }) {
  return <I18nContext.Provider value={{ lang, dict }}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
export const useDict = () => useI18n().dict;
export const useLang = () => useI18n().lang;
