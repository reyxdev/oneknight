import { sql } from "drizzle-orm";
import { boolean, index, inet, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/*
 * First slice of the ONEKNIGHT schema: accounts, organizations, sessions, login history, audit log.
 * Multi-tenant from the start: a user works inside organizations through memberships.
 */

export const roleEnum = pgEnum("member_role", ["owner", "manager", "marketer", "packer"]);
export const siteStatusEnum = pgEnum("site_status", ["building", "live", "paused"]);
export const subStatusEnum = pgEnum("subscription_status", ["trial", "active", "grace", "suspended", "cancelled"]);
export const ledgerKindEnum = pgEnum("ledger_kind", ["topup", "charge", "refund", "adjustment"]);
export const topupStatusEnum = pgEnum("topup_status", ["pending", "confirmed", "cancelled"]);
export const ticketCategoryEnum = pgEnum("ticket_category", ["bug", "question", "change", "oneknight", "site", "other"]);
export const ticketStatusEnum = pgEnum("ticket_status", ["open", "answered", "closed"]);
/** Status groups (the business adds its own statuses inside them): Нове · В роботі · Відправлено · Завершено · Скасовано · Повернення. */
export const orderStatusEnum = pgEnum("order_status", ["new", "confirmed", "shipped", "done", "cancelled", "returned"]);
/** Payment is separate from the status. */
export const paymentStatusEnum = pgEnum("payment_status", ["unpaid", "prepaid", "paid", "refunded"]);
export const reviewStatusEnum = pgEnum("review_status", ["pending", "published", "trash"]);
export const moderationEnum = pgEnum("review_moderation", ["off", "manual"]);
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
  /** Monthly revenue goal shown on Home, in kopecks. Null = not set. */
  goalKop: integer("goal_kop"),
  /** When the «Перші кроки» reward (+7 days) was granted; granted once per business. */
  firstStepsRewardAt: timestamp("first_steps_reward_at", { withTimezone: true }),
  /** Answers to the questions after sign-up (owner). Null = not answered yet: the panel asks first. */
  /** Numbering of orders: the last number given (the first order gets 1001). */
  orderSeq: integer("order_seq").notNull().default(1000),
  /** «Бізнес → Замовлення»: own cancel reasons, own sources of manual orders, hours until a new order is urgent. */
  orderSettings: jsonb("order_settings").notNull().default(sql`'{}'::jsonb`).$type<{ reasons?: string[]; sources?: string[]; urgentHours?: number }>(),
  onboarding: jsonb("onboarding").$type<{ hasSite: boolean; siteUrl?: string; sells: string[]; sellsOther?: string; delivery: string[]; channels: string[]; at: string }>(),
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
    /** Organization the user is working in (members of several businesses switch it). */
    activeOrgId: uuid("active_org_id"),
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
    /** Key the client's website uses for the public API (products, orders, reviews, analytics). Not a secret for reading. */
    reviewModeration: moderationEnum("review_moderation").notNull().default("manual"),
    publicKey: text("public_key").notNull().unique().default(sql`'sk_' || replace(gen_random_uuid()::text, '-', '')`),
    /** Result of the last check, cached for quick lists and for detecting up/down transitions. */
    lastUp: boolean("last_up"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    /** Last time anything with the site's public key (ok.js) called the public API: proves it is installed. */
    okSeenAt: timestamp("ok_seen_at", { withTimezone: true }),
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
    /** Handed to the Telegram delivery worker (sent to linked chats, or nobody to send to). */
    telegramDone: boolean("telegram_done").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_org_idx").on(t.organizationId, t.createdAt), index("notifications_tg_idx").on(t.createdAt).where(sql`not telegram_done`)],
);

/** ONEKNIGHT subscription of an organization (one per organization). */
export const subscriptions = pgTable("subscriptions", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  status: subStatusEnum("status").notNull(),
  /** End of the free period for website customers (3 months). Null when never on trial. */
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  /** The subscription is paid (or free) until this moment; renewal happens here. */
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  /** Set when a renewal could not be paid: service keeps working until this moment. */
  graceUntil: timestamp("grace_until", { withTimezone: true }),
  /** ONEKNIGHT itself is covered by an access key until this moment: renewals starting before it do not charge it. */
  coveredUntil: timestamp("covered_until", { withTimezone: true }),
  /** Last trial-end reminder sent (days before the end: 3, then 1), so each goes once. */
  trialReminded: smallint("trial_reminded"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Money movements. The balance is the sum of amounts. Amounts in kopecks (100 = 1 UAH), charges negative. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    kind: ledgerKindEnum("kind").notNull(),
    amountKop: integer("amount_kop").notNull(),
    /** Machine description: renewal, module:<id>, topup:<reference>... */
    reason: text("reason").notNull(),
    meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_org_idx").on(t.organizationId, t.createdAt)],
);

/** Installed modules. `free` = installed inside the free period within the free-module limit. */
export const moduleInstalls = pgTable(
  "module_installs",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    moduleId: text("module_id").notNull(),
    free: boolean("free").notNull().default(false),
    /** Covered by an access key until this moment: not charged at renewals before it. */
    paidUntil: timestamp("paid_until", { withTimezone: true }),
    installedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.moduleId] })],
);

/** A bank-transfer (IBAN) top-up the client announced. Confirmed manually when the money arrives. */
export const topups = pgTable(
  "topups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    amountKop: integer("amount_kop").notNull(),
    /** Printed in the payment purpose so the transfer can be matched. */
    reference: text("reference").notNull().unique(),
    status: topupStatusEnum("status").notNull().default("pending"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("topups_org_idx").on(t.organizationId, t.createdAt), index("topups_status_idx").on(t.status)],
);

/** Uploaded files (screenshots, product photos, review photos). Stored on disk, served only after an access check. */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    uploaderId: uuid("uploader_id").references(() => users.id, { onDelete: "set null" }),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    /** Name on disk (random). Never derived from user input. */
    storageKey: text("storage_key").notNull().unique(),
    /** Public files (e.g. product photos) may be served without a session. */
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("files_org_idx").on(t.organizationId)],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").generatedAlwaysAsIdentity({ startWith: 201 }).notNull().unique(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    category: ticketCategoryEnum("category").notNull(),
    status: ticketStatusEnum("status").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tickets_org_idx").on(t.organizationId, t.updatedAt), index("tickets_status_idx").on(t.status, t.updatedAt)],
);

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    /** True for replies from ONEKNIGHT support. */
    staff: boolean("staff").notNull().default(false),
    body: text("body").notNull(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("ticket_messages_ticket_idx").on(t.ticketId, t.createdAt)],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    priceKop: integer("price_kop").notNull(),
    /** Null = not tracked (made to order). */
    stock: integer("stock"),
    photoFileId: uuid("photo_file_id").references(() => files.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_site_idx").on(t.siteId, t.sort)],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Own numbering in each business from 1001, set by the database trigger `orders_number` on insert. */
    number: integer("number").notNull().default(0),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    /** Null for orders imported from a marketplace (see `source`). */
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
    /** "site" for orders placed through the public API, otherwise the marketplace ("prom"). */
    source: text("source").notNull().default("site"),
    /** The marketplace's own order id; unique per organization and source, so imports never duplicate. */
    externalId: text("external_id"),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerEmail: text("customer_email"),
    /** Snapshot at the moment of ordering: prices are taken from the database, never from the request. */
    items: jsonb("items").notNull().$type<{ productId: string; name: string; qty: number; priceKop: number }[]>(),
    totalKop: integer("total_kop").notNull(),
    status: orderStatusEnum("status").notNull().default("new"),
    /** The business's own status inside the group (`status`); null = the group's name. */
    statusId: uuid("status_id").references(() => orderStatuses.id, { onDelete: "set null" }),
    /** Required when the order is cancelled: a preset key (changed_mind, out_of_stock, no_answer, duplicate) or the business's text. */
    cancelReason: text("cancel_reason"),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("unpaid"),
    /** Prepayment with cash on delivery: the carrier collects total − prepaid. */
    prepaidKop: integer("prepaid_kop").notNull().default(0),
    /** Responsible person: who took the order in work (or the first to confirm it). */
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    /** «Не додзвонились»: when to call again (shown in «Що треба зробити»). */
    callbackAt: timestamp("callback_at", { withTimezone: true }),
    delivery: jsonb("delivery").notNull().$type<{ method: string; city?: string; branch?: string; address?: string }>(),
    payment: text("payment").notNull(),
    comment: text("comment"),
    /** Warranty is stored as data only: the seller sets the terms. */
    warranty: jsonb("warranty").notNull().default(sql`'{"enabled":false}'::jsonb`).$type<{ enabled: boolean; until?: string; note?: string }>(),
    waybill: text("waybill"),
    /** Nova Poshta document ref when the waybill was created from ONEKNIGHT (used for printing). */
    waybillRef: text("waybill_ref"),
    /** «Приклад» in a new account: not counted anywhere, never sent to a carrier, gone with the first real order. */
    isExample: boolean("is_example").notNull().default(false),
    ip: inet("ip"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_org_idx").on(t.organizationId, t.createdAt),
    index("orders_status_idx").on(t.organizationId, t.status),
    uniqueIndex("orders_external_uq").on(t.organizationId, t.source, t.externalId),
    uniqueIndex("orders_org_number_uq").on(t.organizationId, t.number),
  ],
);

/** The business's own order statuses, each inside a base group; automation works by group. */
export const orderStatuses = pgTable(
  "order_statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    group: orderStatusEnum("group").notNull(),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("order_statuses_org_idx").on(t.organizationId, t.sort)],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    /** One timeline of the order: status, payment, comment, waybill, edit, call. */
    kind: text("kind").notNull().default("status"),
    status: orderStatusEnum("status"),
    /** Details of the event (the custom status name, cancel reason, comment text, what was edited…). */
    data: jsonb("data").$type<Record<string, unknown>>(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    /** True when the author proved a purchase (order number + the phone used in that order). */
    verified: boolean("verified").notNull().default(false),
    authorName: text("author_name").notNull(),
    rating: smallint("rating").notNull(),
    text: text("text").notNull(),
    /** Without consent a review can never be published. */
    consent: boolean("consent").notNull(),
    photoFileId: uuid("photo_file_id").references(() => files.id, { onDelete: "set null" }),
    videoUrl: text("video_url"),
    status: reviewStatusEnum("status").notNull(),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    ip: inet("ip"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reviews_site_status_idx").on(t.siteId, t.status, t.createdAt), index("reviews_org_idx").on(t.organizationId, t.createdAt)],
);

/**
 * Website analytics without cookies: page views, leads and orders with their traffic source.
 * `session` is a random per-tab id from sessionStorage; no IP or personal data is stored.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // pageview | lead | order
    session: text("session").notNull(),
    path: text("path"),
    /** Human channel: instagram, facebook, google, telegram, tiktok, youtube, email, direct, other:<host>. */
    channel: text("channel").notNull(),
    source: text("source"),
    medium: text("medium"),
    campaign: text("campaign"),
    content: text("content"),
    valueKop: integer("value_kop"),
    createdAt: createdAt(),
  },
  (t) => [index("analytics_site_time_idx").on(t.siteId, t.createdAt), index("analytics_site_session_idx").on(t.siteId, t.session)],
);

/** Insights the owner marked as handled; they stay hidden until `until`. */
export const insightDismissals = pgTable(
  "insight_dismissals",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    insightId: text("insight_id").notNull(),
    until: timestamp("until", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.insightId] })],
);

/** One-time invitation link to join an organization with a role and permissions. Only the hash is stored. */
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  role: roleEnum("role").notNull(),
  permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedBy: uuid("used_by").references(() => users.id, { onDelete: "set null" }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Connected external services (Nova Poshta, Prom, ...). Credentials are encrypted at rest and never returned. */
export const integrations = pgTable(
  "integrations",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    credentialsEnc: text("credentials_enc").notNull(),
    /** Non-secret settings (sender city/warehouse, defaults...). */
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    status: text("status").notNull().default("connected"), // connected | error
    lastError: text("last_error"),
    connectedAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.provider] })],
);

export const accessKeyKindEnum = pgEnum("access_key_kind", ["oneknight", "module"]);

/**
 * Access keys generated by the admin: each grants ONEKNIGHT or one module for `months`. Only the SHA-256 of
 * the code is stored; the code itself is shown once, when the batch is generated.
 */
export const accessKeys = pgTable(
  "access_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeHash: text("code_hash").notNull().unique(),
    /** Last 4 characters, to recognise a key in the list. */
    hint: text("hint").notNull(),
    batch: uuid("batch").notNull(),
    kind: accessKeyKindEnum("kind").notNull(),
    moduleId: text("module_id"),
    months: smallint("months").notNull(),
    /** The key can be activated until this moment. */
    activateBefore: timestamp("activate_before", { withTimezone: true }),
    disabled: boolean("disabled").notNull().default(false),
    note: text("note"),
    redeemedBy: uuid("redeemed_by").references(() => organizations.id, { onDelete: "set null" }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("access_keys_batch_idx").on(t.batch)],
);

export const promoKindEnum = pgEnum("promo_kind", ["percent", "bonus"]);

/** Promo codes: a percent discount on the next monthly renewals, or a bonus added to the balance. */
export const promoCodes = pgTable("promo_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stored upper-case; entered case-insensitively. */
  code: text("code").notNull().unique(),
  kind: promoKindEnum("kind").notNull(),
  /** Percent (1-100) or bonus in UAH. */
  value: integer("value").notNull(),
  /** For percent: how many monthly renewals get the discount. */
  months: smallint("months").notNull().default(1),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

/** One use of a promo code by an organization (each organization can use a code once). */
export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    promoId: uuid("promo_id").notNull().references(() => promoCodes.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    /** Percent discount renewals still to apply. */
    monthsLeft: smallint("months_left").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.promoId, t.organizationId] })],
);

/**
 * One-time password reset links. There is no email sending, so the admin creates a link after checking who
 * is asking and sends it through a messenger. Only the SHA-256 of the token is stored.
 */
export const passwordResets = pgTable("password_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  /** Also switch off 2FA (lost phone). Only after the admin has confirmed the person. */
  resetTotp: boolean("reset_totp").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const backupKindEnum = pgEnum("backup_kind", ["auto", "manual"]);

/** Backups of a business's ONEKNIGHT data: gzip JSON files in UPLOAD_DIR/backups. */
export const backups = pgTable(
  "backups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    kind: backupKindEnum("kind").notNull(),
    size: integer("size").notNull(),
    /** Row counts per section, shown in the list. */
    counts: jsonb("counts").notNull().$type<Record<string, number>>(),
    storageKey: text("storage_key").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("backups_org_idx").on(t.organizationId, t.createdAt)],
);

/**
 * A person's Telegram chat for notifications, linked through the bot with a one-time /start token.
 * `kinds` = which notification kinds they want (order, review, site, billing, ticket, team).
 */
export const telegramLinks = pgTable("telegram_links", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  chatId: text("chat_id").unique(),
  username: text("username"),
  linkTokenHash: text("link_token_hash").unique(),
  linkExpiresAt: timestamp("link_expires_at", { withTimezone: true }),
  kinds: text("kinds").array().notNull().default(sql`'{order,review,site,billing,ticket,team}'::text[]`),
  linkedAt: timestamp("linked_at", { withTimezone: true }),
  createdAt: createdAt(),
});
