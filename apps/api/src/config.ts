import { z } from "zod";

/** Environment is validated once at startup. The server refuses to start with a bad config. */
const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default("127.0.0.1"),
  TOTP_ENC_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "TOTP_ENC_KEY must be 32 bytes, base64"),
  APP_ORIGINS: z.string().transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  /** The public address of the site and panel (the status page checks it); defaults to the first APP_ORIGINS. */
  SITE_URL: z.string().url().optional(),
  /** Optional. When both are set, new leads are announced in this Telegram chat. */
  TELEGRAM_BOT_TOKEN: z.string().optional().transform((v) => v || undefined),
  TELEGRAM_CHAT_ID: z.string().optional().transform((v) => v || undefined),
  /** Minutes between monitoring rounds. 0 disables the in-process monitor. */
  /**
   * The panel is closed to everyone except ONEKNIGHT admins (owner's decision, October 2026): no sign-ups, non-admin
   * sign-in refused, existing non-admin sessions ignored. Automated tests always run with the panel open.
   */
  PANEL_CLOSED: z.enum(["0", "1"]).default("0"),
  MONITOR_INTERVAL_MIN: z.coerce.number().int().min(0).default(5),
  /** Days the service keeps working after a failed renewal (product range 3-7). */
  GRACE_DAYS: z.coerce.number().int().min(3).max(7).default(5),
  /** Bank details for top-ups (IBAN transfer). Empty = top-ups are not offered yet. */
  PAYMENT_RECIPIENT: z.string().optional().transform((v) => v || undefined),
  PAYMENT_IBAN: z.string().optional().transform((v) => v || undefined),
  PAYMENT_TAX_ID: z.string().optional().transform((v) => v || undefined),
  /** Where uploaded files are stored. */
  UPLOAD_DIR: z.string().default("var/uploads"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export const env = Env.parse(process.env);
export const isProd = env.NODE_ENV === "production";
/** Tests check the closed panel by setting OK_TEST_PANEL_CLOSED=1 for a moment. */
export const panelClosed = () => (env.PANEL_CLOSED === "1" && env.NODE_ENV !== "test") || process.env.OK_TEST_PANEL_CLOSED === "1";
