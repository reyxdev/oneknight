/**
 * DEMO DATA. An illustrative funnel, not a real result.
 * The brief gives six example figures for a seven-stage funnel (10,000 / 1,240 / 640 / 87 / 31 / 12).
 * The "viewing" stage value (240) is an added demo figure between 640 and 87.
 */
export const funnelDemo = {
  isDemo: true,
  stages: [
    { id: "ad", users: 10000 },
    { id: "click", users: 1240 },
    { id: "site", users: 640 },
    { id: "viewing", users: 240 },
    { id: "action", users: 87 },
    { id: "request", users: 31 },
    { id: "sale", users: 12 },
  ],
  defaultStage: 2,
} as const;
