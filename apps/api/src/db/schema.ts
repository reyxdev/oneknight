import { sql } from "drizzle-orm";
import { boolean, index, inet, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/*
 * First slice of the ONEKNIGHT schema: accounts, organizations, sessions, login history, audit log.
 * Multi-tenant from the start: a user works inside organizations through memberships.
 */

export const roleEnum = pgEnum("member_role", ["owner", "manager", "marketer"]);
export const siteStatusEnum = pgEnum("site_status", ["building", "live", "paused"]);
export const leadStatusEnum = pgEnum("lead_status", ["new", "in_progress", "won", "lost"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    /** Stored lowercased. No email verification by product decision. */
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** TOTP secret, encrypted at rest (set when 2FA is enabled). */
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    /** Last accepted TOTP time step: a code can be used only once (replay protection). */
    totpLastStep: integer("totp_last_step"),
    /** Platform administrator (Ivan). Not an organization role. */
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    /** Granular permissions on top of the role (see Permission in @oneknight/domain). */
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.organizationId] }), index("memberships_org_idx").on(t.organizationId)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token. The token itself is only ever in the user's cookie. */
    idHash: text("id_hash").primaryKey(),
    /** Public id used to list and revoke sessions. Never the token. */
    id: uuid("id").notNull().defaultRandom().unique(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** False until the second factor is confirmed for users with 2FA. */
    mfaPassed: boolean("mfa_passed").notNull().default(false),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginEvents = pgTable(
  "login_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    emailAttempted: text("email_attempted").notNull(),
    success: boolean("success").notNull(),
    /** Short machine reason: ok, bad_password, unknown_email, bad_totp, rate_limited. */
    reason: text("reason").notNull(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("login_events_user_idx").on(t.userId, t.createdAt), index("login_events_ip_idx").on(t.ip, t.createdAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
    ip: inet("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_idx").on(t.organizationId, t.createdAt)],
);

/** A project request (brief) from the public site or the account. Anonymous leads carry their own contact. */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").generatedAlwaysAsIdentity({ startWith: 1001 }).notNull().unique(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    service: text("service").notNull(),
    siteType: text("site_type"),
    /** Brief answers as submitted (business, audience, logo, photos, features, references, special...). */
    brief: jsonb("brief").notNull(),
    status: leadStatusEnum("status").notNull().default("new"),
    source: text("source").notNull(),
    locale: text("locale").notNull(),
    ip: inet("ip"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leads_user_idx").on(t.userId, t.createdAt), index("leads_status_idx").on(t.status, t.createdAt), index("leads_ip_idx").on(t.ip, t.createdAt)],
);

/** A client's website. Belongs to an organization; one organization can have several sites. */
export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    name: text("name").notNull(),
    status: siteStatusEnum("status").notNull().default("live"),
    /** Result of the last check, cached for quick lists and for detecting up/down transitions. */
    lastUp: boolean("last_up"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sites_domain_uq").on(t.domain), index("sites_org_idx").on(t.organizationId)],
);

/** One monitoring probe: HTTPS availability, response time, TLS certificate expiry. */
export const monitorChecks = pgTable(
  "monitor_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    up: boolean("up").notNull(),
    statusCode: smallint("status_code"),
    responseMs: integer("response_ms"),
    sslValidTo: timestamp("ssl_valid_to", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [index("monitor_site_time_idx").on(t.siteId, t.checkedAt)],
);

/** In-account notifications. Keyed messages (rendered in the user's language), with parameters. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_org_idx").on(t.organizationId, t.createdAt)],
);
