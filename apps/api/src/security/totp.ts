import { generateSecret, generateURI, verify } from "otplib";

export const newTotpSecret = () => generateSecret();
export const totpUri = (secret: string, label: string) => generateURI({ issuer: "ONEKNIGHT", label, secret });

/** Accepts one step of clock drift either way. Rejects any step at or before `afterStep` (no code reuse). */
export async function checkTotp(secret: string, code: string, afterStep: number | null): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const r = await verify({ secret, token: code, epochTolerance: 30, ...(afterStep !== null ? { afterTimeStep: afterStep } : {}) }).catch(() => null);
  if (!r || !r.valid) return null;
  const step = (r as { timeStep?: number }).timeStep;
  return typeof step === "number" ? step : null;
}
