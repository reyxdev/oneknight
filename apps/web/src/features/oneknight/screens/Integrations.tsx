"use client";

import { useState } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { useClient, useOkState } from "../state";
import { Panel } from "../ui/kit";
import type { IntegrationId } from "@oneknight/domain";

const OAUTH: IntegrationId[] = ["google", "meta", "telegram"];

export function Integrations() {
  const t = useDict().ok.integrations;
  const s = useOkState();
  const client = useClient();
  const [open, setOpen] = useState<IntegrationId | null>(null);
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "done">("idle");

  const check = async (id: IntegrationId) => {
    setState("checking");
    await client.connectIntegration(id, key);
    setKey("");
    setState("done");
  };

  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <p className="ok-muted">{t.lead}</p>
      <div className="ok-integrations">
        {s.integrations.map((i) => (
          <Panel key={i.id} className="ok-int">
            <header className="ok-int-head">
              <b>{t.names[i.id]}</b>
              <span className="ok-pill" data-s={i.status === "connected" ? "done" : "cancelled"}>{i.status === "connected" ? t.connected : t.notConnected}</span>
            </header>
            {open === i.id ? (
              <div className="ok-int-body">
                {OAUTH.includes(i.id) ? (
                  <>
                    <p className="ok-muted">{i.id === "google" ? t.googleNote : t.oauth}</p>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => check(i.id)} disabled={state === "checking"} data-loading={state === "checking"}>
                      {t.oauth}
                    </button>
                  </>
                ) : (
                  <>
                    <ol className="ok-steps">
                      {t.steps.map((st) => (
                        <li key={st}>{st}</li>
                      ))}
                    </ol>
                    <label className="field">
                      <span className="label">{t.key}</span>
                      <input className="input" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
                    </label>
                    <button type="button" className="btn btn-sm" disabled={!key.trim() || state === "checking"} data-loading={state === "checking"} onClick={() => check(i.id)}>
                      {state === "checking" ? t.checking : t.check}
                    </button>
                  </>
                )}
                {state === "done" && <p className="ok-note" role="status"><Icon name="shield" size={15} />{t.demoResult}</p>}
              </div>
            ) : (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setOpen(i.id); setState("idle"); setKey(""); }}>
                <Icon name="link" size={15} />{t.connect}
              </button>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}
