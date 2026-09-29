import { connect } from "node:tls";

export type ProbeResult = { up: boolean; statusCode: number | null; responseMs: number | null; sslValidTo: Date | null; error: string | null };

const UA = "ONEKNIGHT-Monitor/1.0 (+https://oneknight.pro)";

/** Public hostnames only: no IPs, no local or internal names (the monitor must not probe private networks). */
export function normalizeDomain(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  if (/\.(local|localhost|internal|lan|home|test|invalid|example)$/.test(host)) return null;
  return host;
}

function certExpiry(host: string): Promise<Date | null> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 443, servername: host, timeout: 8000, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert?.valid_to ? new Date(cert.valid_to) : null);
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

/** One HTTPS probe of the site's home page plus its certificate expiry. Up = final status 2xx/3xx within 10 s. */
export async function probe(domain: string): Promise<ProbeResult> {
  const t0 = performance.now();
  const [page, sslValidTo] = await Promise.all([
    fetch(`https://${domain}/`, { redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(10_000) })
      .then(async (res) => {
        const ms = Math.round(performance.now() - t0);
        await res.body?.cancel().catch(() => {});
        return { statusCode: res.status, responseMs: ms, error: null as string | null };
      })
      .catch((e: unknown) => ({ statusCode: null, responseMs: null, error: e instanceof Error ? (e.name === "TimeoutError" ? "timeout" : (e.cause as { code?: string } | undefined)?.code ?? e.message) : "error" })),
    certExpiry(domain),
  ]);
  const up = page.statusCode !== null && page.statusCode < 400;
  return { up, statusCode: page.statusCode, responseMs: page.responseMs, sslValidTo, error: up ? null : page.error ?? `http_${page.statusCode}` };
}
