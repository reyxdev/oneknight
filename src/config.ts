/** Feature flags and tunables. Nothing secret lives here (this file ships to the browser). */
export const config = {
  siteUrl: "https://oneknight.pro",
  sound: { defaultEnabled: false },
  motion: { defaultMode: "full" as "full" | "calm" },
  subscription: { graceDaysMin: 3, graceDaysMax: 7, graceDaysDefault: 5 },
  reviews: { trashRetentionDays: 30 },
} as const;

export type Lang = "uk" | "en";
export const langs: Lang[] = ["uk", "en"];
