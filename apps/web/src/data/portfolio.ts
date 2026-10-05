/** Numbers the owner changes (answers 107, 394). Moves to the admin together with the calculator. */
export const portfolio = {
  /** Places left with the −25% discount for the first 10 clients; 0 hides the bar. */
  placesLeft: 8,
} as const;

/** Business types of the portfolio («Впізнаєте себе?», the calculator presets, answers 121, 301–308). */
export const SPRAVY = ["sto", "shop", "master", "usadba", "salon", "producer", "home", "cafe"] as const;
export type Sprava = (typeof SPRAVY)[number];
