/**
 * Nova Poshta API v2 client (https://api.novaposhta.ua/v2.0/json/). The business uses its own API key.
 * `call` is injectable so the flows can be tested against recorded responses.
 */
export type NpCall = (apiKey: string, modelName: string, calledMethod: string, methodProperties: Record<string, unknown>) => Promise<NpResponse>;
export type NpResponse = { success: boolean; data: any[]; errors: string[] };

export const npCall: NpCall = async (apiKey, modelName, calledMethod, methodProperties) => {
  const res = await fetch("https://api.novaposhta.ua/v2.0/json/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey, modelName, calledMethod, methodProperties }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { success: false, data: [], errors: [`http_${res.status}`] };
  return (await res.json()) as NpResponse;
};

export type NpSender = { counterparty: string; contact: string; phone: string; name: string };
export type NpSettings = { cityRef?: string; cityName?: string; warehouseRef?: string; warehouseName?: string; weight?: number; description?: string };

/** A valid key returns the business's sender counterparty; an invalid one returns an error from Nova Poshta. */
export async function verifyKey(key: string, call: NpCall = npCall): Promise<{ ok: true; sender: NpSender } | { ok: false; error: string }> {
  const c = await call(key, "Counterparty", "getCounterparties", { CounterpartyProperty: "Sender", Page: "1" });
  if (!c.success || !c.data[0]) return { ok: false, error: c.errors[0] ?? "no_sender" };
  const cp = c.data[0];
  const p = await call(key, "Counterparty", "getCounterpartyContactPersons", { Ref: cp.Ref, Page: "1" });
  const person = p.success ? p.data[0] : null;
  if (!person) return { ok: false, error: p.errors[0] ?? "no_contact_person" };
  return { ok: true, sender: { counterparty: cp.Ref, contact: person.Ref, phone: String(person.Phones ?? ""), name: String(person.Description ?? cp.Description ?? "") } };
}

export async function findCities(key: string, q: string, call: NpCall = npCall) {
  const r = await call(key, "Address", "getCities", { FindByString: q, Limit: "10" });
  return r.success ? r.data.map((c) => ({ ref: String(c.Ref), name: String(c.Description), area: String(c.AreaDescription ?? "") })) : [];
}

export async function findWarehouses(key: string, cityRef: string, q: string, call: NpCall = npCall) {
  const r = await call(key, "Address", "getWarehouses", { CityRef: cityRef, FindByString: q, Limit: "20" });
  return r.success ? r.data.map((w) => ({ ref: String(w.Ref), name: String(w.Description), number: String(w.Number ?? "") })) : [];
}

const onlyDigits = (s: string) => s.replace(/\D/g, "");
/** Nova Poshta expects 380XXXXXXXXX. */
export function npPhone(phone: string) {
  const d = onlyDigits(phone);
  if (d.length === 12 && d.startsWith("380")) return d;
  if (d.length === 10 && d.startsWith("0")) return `38${d}`;
  if (d.length === 9) return `380${d}`;
  return d;
}
function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0]!, last: parts[0]! };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}
const today = () => new Date().toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" });

export type WaybillInput = {
  customerName: string;
  customerPhone: string;
  /** Declared value = the order sum. */
  totalUah: number;
  cod: boolean;
  /** Cash on delivery to collect (sum − prepayment); the declared value when omitted. */
  codUah?: number;
  recipientCityRef: string;
  recipientWarehouseRef: string;
};

/** Creates the recipient (private person) and the express waybill from the sender's warehouse to the recipient's warehouse. */
export async function createWaybill(key: string, sender: NpSender, settings: NpSettings, input: WaybillInput, call: NpCall = npCall): Promise<{ ok: true; number: string; ref: string; cost: number | null } | { ok: false; error: string }> {
  if (!settings.cityRef || !settings.warehouseRef) return { ok: false, error: "sender_address_missing" };
  const { first, last } = splitName(input.customerName);
  const rec = await call(key, "Counterparty", "save", { CounterpartyType: "PrivatePerson", CounterpartyProperty: "Recipient", FirstName: first, LastName: last, MiddleName: "", Phone: npPhone(input.customerPhone) });
  const recipient = rec.success ? rec.data[0] : null;
  const contact = recipient?.ContactPerson?.data?.[0]?.Ref;
  if (!recipient || !contact) return { ok: false, error: rec.errors[0] ?? "recipient_failed" };
  const props: Record<string, unknown> = {
    PayerType: "Recipient",
    PaymentMethod: "Cash",
    DateTime: today(),
    CargoType: "Parcel",
    Weight: String(settings.weight ?? 1),
    ServiceType: "WarehouseWarehouse",
    SeatsAmount: "1",
    Description: settings.description || "Товар",
    Cost: String(Math.max(1, Math.round(input.totalUah))),
    CitySender: settings.cityRef,
    Sender: sender.counterparty,
    SenderAddress: settings.warehouseRef,
    ContactSender: sender.contact,
    SendersPhone: npPhone(sender.phone),
    CityRecipient: input.recipientCityRef,
    Recipient: recipient.Ref,
    RecipientAddress: input.recipientWarehouseRef,
    ContactRecipient: contact,
    RecipientsPhone: npPhone(input.customerPhone),
  };
  if (input.cod) props.BackwardDeliveryData = [{ PayerType: "Recipient", CargoType: "Money", RedeliveryString: String(Math.round(input.codUah ?? input.totalUah)) }];
  const doc = await call(key, "InternetDocument", "save", props);
  const d = doc.success ? doc.data[0] : null;
  if (!d?.IntDocNumber) return { ok: false, error: doc.errors[0] ?? "waybill_failed" };
  return { ok: true, number: String(d.IntDocNumber), ref: String(d.Ref), cost: d.CostOnSite != null ? Number(d.CostOnSite) : null };
}
