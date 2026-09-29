/**
 * DEMO DATA for the service illustrations. Not real client results.
 * Analytics numbers are consistent with the demo funnel (640 visits, 31 requests, 12 sales).
 */
export const servicesDemo = {
  isDemo: true,
  analytics: {
    kpi: [640, 31, 12],
    sources: [
      { visits: 240, leads: 18, sales: 4 },
      { visits: 180, leads: 7, sales: 4 },
      { visits: 120, leads: 4, sales: 3 },
      { visits: 100, leads: 2, sales: 1 },
    ],
    rawLines: [
      "12:01 GET /catalog utm_source=ig utm_campaign=reel17",
      "12:01 click #buy-btn  sid=8f2a  dev=mobile",
      "12:02 GET /product/12 ref=google.com/search",
      "12:02 scroll 40%  sid=8f2a",
      "12:03 GET /  utm_source=tg  utm_medium=post",
      "12:03 form_start #order  sid=c19d",
      "12:04 GET /cart  sid=8f2a",
      "12:04 form_abandon #order  sid=c19d",
      "12:05 GET /catalog utm_source=ig utm_campaign=reel17",
      "12:05 lead_submit  sid=8f2a  src=ig",
      "12:06 GET /about  direct",
      "12:07 GET /product/7 ref=google.com/search",
      "12:07 click #phone  sid=77be",
      "12:08 GET /catalog utm_source=tg utm_medium=post",
    ],
  },
  advertising: [
    { budget: 0, shown: 0, clicks: 0, leads: 0 },
    { budget: 0, shown: 0, clicks: 0, leads: 0 },
    { budget: 500, shown: 4200, clicks: 120, leads: 3 },
    { budget: 500, shown: 4600, clicks: 131, leads: 5 },
    { budget: 500, shown: 5200, clicks: 210, leads: 11 },
    { budget: 1500, shown: 16800, clicks: 690, leads: 38 },
  ],
} as const;
