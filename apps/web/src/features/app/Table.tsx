"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";

export type Col<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Sortable: a value for sorting here, or `true` when the server sorts. */
  sort?: ((row: T) => string | number) | true;
  align?: "end";
  /** Cannot be hidden (the main column). */
  fixed?: boolean;
};
export type Sort = { key: string; dir: "asc" | "desc" };
export const PAGE = 50;

const read = (id: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(`ok.cols.${id}`) ?? "[]") as string[];
  } catch {
    return [];
  }
};

/**
 * Lists of the panel: sortable columns, pages of 50, columns that can be hidden (remembered on this device),
 * ↑↓ Enter on rows, the open row highlighted (its details are in the panel on the right). On a phone every
 * row becomes a card. Sorting and pages run here, or on the server when `server` is given.
 */
export function Table<T extends { id: string }>({
  id,
  label,
  rows,
  cols,
  active,
  onOpen,
  sort,
  onSort,
  page,
  onPage,
  hasMore,
}: {
  id: string;
  label: string;
  rows: T[];
  cols: Col<T>[];
  active?: string | null;
  onOpen?: (row: T) => void;
  sort: Sort;
  onSort: (s: Sort) => void;
  page: number;
  onPage: (p: number) => void;
  /** Server paging: whether a next page exists (rows are already one page). Omitted: pages are made here. */
  hasMore?: boolean;
}) {
  const t = useDict().app.table;
  const [hidden, setHidden] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const body = useRef<HTMLTableSectionElement>(null);
  useEffect(() => setHidden(read(id)), [id]);
  const toggleCol = (key: string) =>
    setHidden((h) => {
      const next = h.includes(key) ? h.filter((x) => x !== key) : [...h, key];
      try {
        localStorage.setItem(`ok.cols.${id}`, JSON.stringify(next));
      } catch {}
      return next;
    });

  const server = hasMore !== undefined;
  const shown = cols.filter((c) => c.fixed || !hidden.includes(c.key));
  let list = rows;
  if (!server) {
    const c = cols.find((x) => x.key === sort.key);
    if (c && typeof c.sort === "function") {
      const get = c.sort;
      list = [...rows].sort((a, b) => {
        const x = get(a);
        const y = get(b);
        const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "uk");
        return sort.dir === "asc" ? r : -r;
      });
    }
    list = list.slice((page - 1) * PAGE, page * PAGE);
  }
  const pages = server ? null : Math.max(1, Math.ceil(rows.length / PAGE));
  const next = server ? hasMore : page < (pages ?? 1);

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    const trs = [...(body.current?.querySelectorAll<HTMLTableRowElement>("tr[tabindex]") ?? [])];
    const i = trs.indexOf(e.currentTarget);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      trs[Math.min(trs.length - 1, i + 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      trs[Math.max(0, i - 1)]?.focus();
    } else if (e.key === "Enter" && onOpen) {
      e.preventDefault();
      onOpen(row);
    }
  };

  return (
    <div className="app-table-wrap">
      <div className="app-table-tools">
        <div className="app-cols">
          <button type="button" className="btn btn-sm btn-ghost" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><Icon name="table" size={15} />{t.columns}</button>
          {menu && (
            <div className="app-cols-pop" role="group" aria-label={t.columns}>
              {cols.filter((c) => !c.fixed).map((c) => (
                <label key={c.key}><input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => toggleCol(c.key)} />{c.label}</label>
              ))}
            </div>
          )}
        </div>
      </div>
      <table className="app-table" aria-label={label}>
        <thead>
          <tr>
            {shown.map((c) => (
              <th key={c.key} scope="col" data-align={c.align} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                {c.sort ? (
                  <button type="button" onClick={() => { onSort({ key: c.key, dir: sort.key === c.key && sort.dir === "desc" ? "asc" : "desc" }); onPage(1); }}>
                    {c.label}
                    <span className="app-sort" aria-hidden="true">{sort.key === c.key ? (sort.dir === "asc" ? "↑" : "↓") : ""}</span>
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={body}>
          {list.map((row) => (
            <tr
              key={row.id}
              tabIndex={onOpen ? 0 : undefined}
              aria-current={active === row.id ? "true" : undefined}
              onClick={onOpen ? () => onOpen(row) : undefined}
              onKeyDown={(e) => onKey(e, row)}
            >
              {shown.map((c) => (
                <td key={c.key} data-label={c.label} data-align={c.align} data-main={c.fixed || undefined}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(page > 1 || next) && (
        <nav className="app-pages" aria-label={t.pages}>
          <button type="button" className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t.prev}</button>
          <span className="ok-muted num">{pages ? fmt(t.pageOf, { n: page, total: pages }) : fmt(t.page, { n: page })}</span>
          <button type="button" className="btn btn-sm btn-ghost" disabled={!next} onClick={() => onPage(page + 1)}>{t.next}</button>
        </nav>
      )}
    </div>
  );
}
