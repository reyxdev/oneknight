import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, 0/8, multicast; IPv6 loopback, local and mapped v4. */
export function privateAddress(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}

const UA = "ONEKNIGHT/1.0 (+https://oneknight.pro)";

/**
 * A request to a public address (an import, a picture, a client's website): http(s) on public hosts only, every
 * redirect checked again, a size limit and a timeout. The server never reaches its own network this way.
 * Any status comes back (the audit wants 404s); `ms` is the time to the response headers.
 */
export async function publicRequest(url: string, opts: { maxBytes: number; method?: "GET" | "HEAD"; timeoutMs?: number }) {
  let target = url;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(target);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad_url");
    if (u.username || u.password || isIP(u.hostname.replace(/^\[|\]$/g, ""))) throw new Error("bad_url");
    const addrs = await lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new Error("bad_url");
    const t0 = performance.now();
    const res = await fetch(u, { method: opts.method ?? "GET", redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000), headers: { "user-agent": UA, "accept-encoding": "gzip, br" } });
    const ms = Math.round(performance.now() - t0);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      target = new URL(res.headers.get("location")!, u).toString();
      continue;
    }
    if (Number(res.headers.get("content-length") ?? 0) > opts.maxBytes) throw new Error("file_too_large");
    const chunks: Buffer[] = [];
    let size = 0;
    if (res.body && opts.method !== "HEAD")
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > opts.maxBytes) throw new Error("file_too_large");
        chunks.push(Buffer.from(chunk));
      }
    return { status: res.status, headers: res.headers, body: Buffer.concat(chunks), url: target, ms, redirects: hop };
  }
  throw new Error("too_many_redirects");
}

/** The body of a public file, or an error for anything but 2xx. */
export async function publicFetch(url: string, maxBytes: number): Promise<Buffer> {
  const r = await publicRequest(url, { maxBytes });
  if (r.status < 200 || r.status >= 300) throw new Error(`http_${r.status}`);
  return r.body;
}

/**
 * A POST to a public address (a client's webhook): the host must resolve to public addresses only (outside
 * production, localhost is allowed for a site developed on the same machine); redirects are not followed.
 */
export async function publicPost(url: string, body: string, headers: Record<string, string>, opts: { timeoutMs?: number; allowLocal?: boolean } = {}) {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad_url");
  if (u.username || u.password) throw new Error("bad_url");
  const local = opts.allowLocal && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  if (!local) {
    if (isIP(u.hostname.replace(/^\[|\]$/g, ""))) throw new Error("bad_url");
    const addrs = await lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new Error("bad_url");
  }
  const t0 = performance.now();
  const res = await fetch(u, { method: "POST", redirect: "manual", body, signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), headers: { "user-agent": UA, "content-type": "application/json", ...headers } });
  const text = (await res.text().catch(() => "")).slice(0, 500);
  return { status: res.status, body: text, ms: Math.round(performance.now() - t0) };
}
