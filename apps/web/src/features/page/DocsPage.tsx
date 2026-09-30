"use client";

import { useState } from "react";
import type { Lang } from "@/config";
import { apiDocs, type DocBlock } from "@/data/api-docs";
import { useDict } from "@/i18n/provider";

const TABS = ["js", "curl", "php"] as const;

function Examples({ ex }: { ex: Extract<DocBlock, { kind: "examples" }> }) {
  const t = useDict().docsPage;
  const [tab, setTab] = useState<(typeof TABS)[number]>("js");
  return (
    <div className="docs-examples">
      <div role="tablist" aria-label={t.examples} className="docs-tabs">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t.tabs[k]}</button>
        ))}
      </div>
      <pre role="tabpanel"><code>{ex[tab]}</code></pre>
    </div>
  );
}

function Block({ b, lang }: { b: DocBlock; lang: Lang }) {
  const t = useDict().docsPage;
  switch (b.kind) {
    case "p":
      return <p>{b[lang]}</p>;
    case "list":
      return <ul className="docs-list">{b[lang].map((x) => <li key={x}>{x}</li>)}</ul>;
    case "endpoint":
      return (
        <div className="docs-endpoint">
          <code><b data-method={b.method}>{b.method}</b> {b.path}</code>
          <p>{b[lang]}</p>
        </div>
      );
    case "fields":
      return (
        <div className="docs-fields" role="table" aria-label={t.fields}>
          {b.rows.map((r) => (
            <div role="row" key={r.name}>
              <code role="cell">{r.name}</code>
              <span role="cell" className="docs-type">{r.type}</span>
              <span role="cell">{r[lang]}</span>
            </div>
          ))}
        </div>
      );
    case "code":
      return <pre className="docs-code"><code>{b.code}</code></pre>;
    case "examples":
      return <Examples ex={b} />;
  }
}

/** /docs/api: the public API for client websites, in Ukrainian and English (owner's decisions H30–H32). */
export function DocsPage({ lang }: { lang: Lang }) {
  const t = useDict().docsPage;
  return (
    <section className="section docs-page" aria-labelledby="docs-title">
      <div className="wrap docs-grid">
        <nav className="docs-nav" aria-label={t.contents}>
          <p className="eyebrow">{t.contents}</p>
          <ol>
            {apiDocs.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s[lang]}</a></li>)}
          </ol>
        </nav>
        <div className="docs-body">
          <h1 id="docs-title" className="h1">{t.title}</h1>
          <p className="lead">{t.lead}</p>
          {apiDocs.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
              <h2 id={`${s.id}-h`} className="h3">{s[lang]}</h2>
              {s.blocks.map((b, i) => <Block key={i} b={b} lang={lang} />)}
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
