/** Feature flags and tunables. Nothing secret lives here (this file ships to the browser). */
export const config = {
  siteUrl: "https://oneknight.pro",
  sound: { defaultEnabled: false },
  motion: { defaultMode: "full" as "full" | "calm" },
  subscription: { graceDaysMin: 3, graceDaysMax: 7, graceDaysDefault: 5 },
  reviews: { trashRetentionDays: 30 },
  /**
   * «soon»: the public site shows only the «скоро» page while the new portfolio is built (owner's decision 348);
   * the panel itself is closed to everyone but the admin (API: PANEL_CLOSED). «full»: the site as built.
   */
  siteMode: "soon" as "soon" | "full",
} as const;

export type Lang = "uk" | "en";
export const langs: Lang[] = ["uk", "en"];
