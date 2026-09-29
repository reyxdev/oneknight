import type {
  Customization, ID, IntegrationId, Moderation, ModuleId, OkState, OrderStatus, TicketCategory,
} from "./domain";

export type ActionResult = { ok: true } | { ok: false; reason: "insufficient_balance" | "not_available" | "requires_module" | "invalid" };

/**
 * The contract every ONEKNIGHT screen depends on. Screens never import demo data.
 * Demo: in-memory implementation. Production: an API client with the same shape
 * (snapshot cache + server-sent events feeding `subscribe`).
 */
export interface OneKnightClient {
  readonly mode: "demo" | "live";
  getState(): OkState;
  subscribe(listener: () => void): () => void;
  /** Real-time events (new order, review, ...). Returns an unsubscribe function. */
  onEvent(listener: (e: { kind: string; id: ID }) => void): () => void;

  setActiveSite(id: ID): void;
  setOrderStatus(id: ID, status: OrderStatus): ActionResult;
  createWaybill(id: ID): ActionResult;
  adjustStock(id: ID, delta: number): void;
  addProduct(name: string, price: number): ActionResult;
  setModeration(m: Moderation): void;
  moderateReview(id: ID, action: "approve" | "reject" | "restore" | "delete"): void;
  installModule(id: ModuleId): ActionResult;
  uninstallModule(id: ModuleId): void;
  markAllRead(): void;
  completeRecommendation(id: ID): void;
  updateCustomization(patch: Partial<Customization>): void;
  runBackup(): void;
  restoreBackup(id: ID): void;
  createTicket(category: TicketCategory, text: string, screenshot: boolean): ActionResult;
  /** Verifies user-supplied credentials with the external service. The demo never pretends to connect. */
  connectIntegration(id: IntegrationId, key: string): Promise<ActionResult>;
  /** Demo-only scenario switch used to show the grace period UI. Not part of the live API. */
  simulateLowBalance?(on: boolean): void;
  /** Starts/stops simulated incoming events. Demo only. */
  setLive?(on: boolean): void;
}
