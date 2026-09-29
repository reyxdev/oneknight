"use client";

import { useRef, useState } from "react";
import { useDict } from "@/i18n/provider";
import { useLiveWhileVisible, useOkState } from "./state";
import { Shell, type ScreenId } from "./ui/Shell";
import { Home } from "./screens/Home";
import { Orders } from "./screens/Orders";
import { Products } from "./screens/Products";
import { Reviews } from "./screens/Reviews";
import { Modules } from "./screens/Modules";
import { Site } from "./screens/Site";
import { Analytics } from "./screens/Analytics";
import { Integrations } from "./screens/Integrations";
import { Support } from "./screens/Support";
import { Account } from "./screens/Account";
import { Settings } from "./screens/Settings";
import { Services } from "./screens/Services";

export default function Playground() {
  const t = useDict().ok;
  const s = useOkState();
  const [screen, setScreen] = useState<ScreenId>("home");
  const ref = useRef<HTMLDivElement>(null);
  useLiveWhileVisible(ref);

  // A screen whose module was switched off falls back to Home.
  const installed = new Set(s.modules.map((m) => m.id));
  const current: ScreenId = (screen === "analytics" && !installed.has("analytics")) || (screen === "reviews" && !installed.has("reviews")) ? "home" : screen;

  const go = (id: ScreenId) => {
    setScreen(id);
    ref.current?.querySelector(".ok-content")?.scrollTo({ top: 0 });
  };

  const screens: Record<ScreenId, React.ReactNode> = {
    home: <Home go={go} />,
    orders: <Orders go={go} />,
    site: <Site />,
    analytics: <Analytics />,
    products: <Products />,
    reviews: <Reviews />,
    modules: <Modules />,
    integrations: <Integrations />,
    services: <Services />,
    support: <Support />,
    account: <Account />,
    settings: <Settings />,
  };

  return (
    <div ref={ref} className="ok-frame" aria-label={t.playgroundTitle}>
      <Shell screen={current} go={go}>
        {screens[current]}
      </Shell>
    </div>
  );
}
