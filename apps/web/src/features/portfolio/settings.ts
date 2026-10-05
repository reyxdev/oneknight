"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PORTFOLIO_PRICES, type PortfolioPrices } from "@oneknight/domain";
import { api } from "@/lib/api";

/** What the owner changes in the admin (answers 107, 243, 468, 485): prices, discounted places left, sites in work. */
export type PortfolioSettings = { prices: PortfolioPrices; placesLeft: number; buildingNow: number };

/** Until the server answers (or if it can't), the page shows the owner's numbers from the answers. */
export const DEFAULT_SETTINGS: PortfolioSettings = { prices: DEFAULT_PORTFOLIO_PRICES, placesLeft: 8, buildingNow: 0 };

let cache: Promise<PortfolioSettings> | null = null;
const load = () =>
  (cache ??= api<PortfolioSettings>("/site/portfolio").then((r) => {
    if (r.ok) return r.data;
    cache = null;
    return DEFAULT_SETTINGS;
  }));

export function usePortfolioSettings(): PortfolioSettings {
  const [s, setS] = useState(DEFAULT_SETTINGS);
  useEffect(() => {
    let live = true;
    void load().then((x) => live && setS(x));
    return () => {
      live = false;
    };
  }, []);
  return s;
}
