"use client";

import dynamic from "next/dynamic";

const demos = {
  websites: dynamic(() => import("./demos/WebsitesDemo").then((m) => m.WebsitesDemo)),
  automation: dynamic(() => import("./demos/AutomationDemo").then((m) => m.AutomationDemo)),
  analytics: dynamic(() => import("./demos/AnalyticsDemo").then((m) => m.AnalyticsDemo)),
  advertising: dynamic(() => import("./demos/AdvertisingDemo").then((m) => m.AdvertisingDemo)),
  seo: dynamic(() => import("./demos/SeoDemo").then((m) => m.SeoDemo)),
};

export type ServiceId = keyof typeof demos;

export function ServiceDemo({ id }: { id: ServiceId }) {
  const Demo = demos[id];
  return <Demo />;
}
