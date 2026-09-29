/**
 * Ukrposhta eCom API 0.0.1 and address classifier (official docs dev.ukrposhta.ua, API documentation
 * 02.09.2026, address classifier v3.22). Every call carries `Authorization: Bearer <eCom bearer>`; clients,
 * shipments and printing also take `?token=<counterparty token>`. Both are issued by Ukrposhta with the contract.
 */
export type UpFetch = (url: string, init: { method?: string; bearer: string; body?: unknown; binary?: boolean }) => Promise<{ status: number; body: any; buffer?: Buffer }>;

export const ECOM = "https://www.ukrposhta.ua/ecom/0.0.1";
export const FORMS = "https://www.ukrposhta.ua/forms/ecom/0.0.1";
export const CLASSIFIER = "https://www.ukrposhta.ua/address-classifier-ws";

export const upFetch: UpFetch = async (url, init) => {
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${init.bearer}`, accept: init.binary ? "application/pdf" : "application/json", ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (init.binary && res.ok) return { status: res.status, body: null, buffer: Buffer.from(await res.arrayBuffer()) };
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    return { status: 0, body: { message: String(e) } };
  }
};

export type UpSender = {
  type: "INDIVIDUAL" | "PRIVATE_ENTREPRENEUR" | "COMPANY";
  firstName?: string;
  lastName?: string;
  middleName?: string;
  companyName?: string;
  phone: string;
  tin?: string;
  edrpou?: string;
  bankAccount?: string;
};
export type UpCreds = { bearer: string; token: string; sender: UpSender };
export type UpSettings = {
  cityRef?: string;
  cityName?: string;
  warehouseRef?: string;
  warehouseName?: string;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  description?: string;
  /** Sender client uuid per sender postcode: a sender client is bound to its address. */
  senders?: Record<string, string>;
};

/** Human-readable error from any Ukrposhta answer. */
export function upError(r: { status: number; body: any }): string {
  const b = r.body;
  return String(b?.message ?? b?.error_description ?? b?.error ?? (Array.isArray(b?.errors) ? b.errors.join("; ") : null) ?? `http_${r.status}`).slice(0, 300);
}

/** Digits only, national format, as in the docs examples ("0671231234"). */
export function upPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("380")) return `0${d.slice(3)}`;
  if (d.length === 9) return `0${d}`;
  return d;
}

/** Read-only call that needs both the bearer and the token (docs: GET /phones/UA/prohibited). */
export async function verifyUp(bearer: string, token: string, f: UpFetch = upFetch): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await f(`${ECOM}/phones/UA/prohibited?token=${encodeURIComponent(token)}`, { bearer });
  return r.status === 200 ? { ok: true } : { ok: false, error: r.status === 401 ? "unauthorized" : upError(r) };
}

const entries = (b: any): any[] => {
  const e = b?.Entries?.Entry;
  return Array.isArray(e) ? e : e ? [e] : [];
};

/** City ref = "<KATOTTG>|<CITY_ID>" so offices can be listed by KATOTTG (classifier §2.8). */
export async function upCities(bearer: string, q: string, f: UpFetch = upFetch) {
  if (q.trim().length < 2) return [];
  const r = await f(`${CLASSIFIER}/get_city_by_region_id_and_district_id_and_city_ua?city_ua=${encodeURIComponent(q.trim())}`, { bearer });
  return entries(r.body)
    .filter((c) => c.CITY_KATOTTG)
    .slice(0, 15)
    .map((c) => ({ ref: `${c.CITY_KATOTTG}|${c.CITY_ID}`, name: `${c.SHORTCITYTYPE_UA ?? ""} ${c.CITY_UA}`.trim(), area: [c.DISTRICT_UA, c.REGION_UA].filter(Boolean).join(", ") }));
}

/** Working offices of a city; ref = POSTCODE (the value an address needs, per "Пошук відділень та індексів"). */
export async function upOffices(bearer: string, cityRef: string, q: string, f: UpFetch = upFetch) {
  const katottg = cityRef.split("|")[0]!;
  const r = await f(`${CLASSIFIER}/get_postoffices_by_postcode_cityid_cityvpzid?city_katottg=${encodeURIComponent(katottg)}`, { bearer });
  const needle = q.trim().toLowerCase();
  return entries(r.body)
    .filter((o) => String(o.LOCK_CODE ?? "0") === "0" && String(o.IS_SECURITY ?? "0") !== "1")
    .map((o) => {
      const postcode = String(o.POSTCODE ?? o.POSTINDEX);
      return { ref: postcode, name: `${postcode} ${o.POSTOFFICE_UA ?? ""}${o.STREET_UA_VPZ ? `: ${o.STREET_UA_VPZ}` : ""}`.trim(), number: postcode };
    })
    .filter((o) => !needle || o.name.toLowerCase().includes(needle))
    .slice(0, 30);
}

/** The office for a postcode (classifier §2.1), used to prefill the recipient from the order. */
export async function upOfficeByPostcode(bearer: string, postcode: string, f: UpFetch = upFetch) {
  const r = await f(`${CLASSIFIER}/get_postoffices_by_postindex?pi=${encodeURIComponent(postcode)}`, { bearer });
  const o = entries(r.body).find((x) => String(x.LOCK_CODE ?? "0") === "0");
  if (!o) return null;
  const code = String(o.POSTCODE ?? o.POSTINDEX);
  return { city: { ref: `|${o.POCITY_ID ?? ""}`, name: String(o.CITY_UA ?? ""), area: "" }, office: { ref: code, name: `${code} ${o.PO_SHORT ?? ""}${o.ADDRESS ? `: ${o.ADDRESS}` : ""}`.trim(), number: code } };
}

async function createAddress(c: UpCreds, postcode: string, f: UpFetch) {
  const r = await f(`${ECOM}/addresses`, { method: "POST", bearer: c.bearer, body: { postcode } });
  return r.status === 200 && r.body?.id != null ? { ok: true as const, id: r.body.id } : { ok: false as const, error: upError(r) };
}

function splitName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: parts[0]! };
  // Orders usually have "Ім'я Прізвище"; the last word is taken as the last name.
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1)! };
}

/** Sender client for a sender postcode (created once per postcode and remembered). */
export async function ensureSender(c: UpCreds, postcode: string, known: string | undefined, f: UpFetch): Promise<{ ok: true; uuid: string; created: boolean } | { ok: false; error: string }> {
  if (known) return { ok: true, uuid: known, created: false };
  const a = await createAddress(c, postcode, f);
  if (!a.ok) return a;
  const s = c.sender;
  const body: Record<string, unknown> = { type: s.type, addressId: a.id, phoneNumber: upPhone(s.phone) };
  if (s.type === "COMPANY") Object.assign(body, { name: s.companyName, edrpou: s.edrpou });
  else Object.assign(body, { firstName: s.firstName, lastName: s.lastName, ...(s.middleName ? { middleName: s.middleName } : {}), ...(s.type === "PRIVATE_ENTREPRENEUR" ? { tin: s.tin } : {}) });
  if (s.bankAccount) body.bankAccount = s.bankAccount;
  const r = await f(`${ECOM}/clients?token=${encodeURIComponent(c.token)}`, { method: "POST", bearer: c.bearer, body });
  return r.status === 200 && r.body?.uuid ? { ok: true, uuid: String(r.body.uuid), created: true } : { ok: false, error: upError(r) };
}

export type UpShipmentInput = {
  senderUuid: string;
  recipientPostcode: string;
  customerName: string;
  customerPhone: string;
  /** Declared value = the order sum. */
  totalUah: number;
  cod: boolean;
  /** Cash on delivery to collect (sum − prepayment); the declared value when omitted. */
  codUah?: number;
  weightKg: number;
  length: number;
  width: number;
  height: number;
  description?: string;
};

/**
 * Recipient (individual, address = recipient office postcode) + a STANDARD W2W shipment with declared value =
 * order total; the recipient pays delivery. Cash on delivery: an individual sender gets cash; a ФОП or company
 * sender only to the bank account (the docs forbid cash COD for them).
 */
export async function createUpShipment(c: UpCreds, input: UpShipmentInput, f: UpFetch = upFetch): Promise<{ ok: true; uuid: string; barcode: string; cost: number | null } | { ok: false; error: string }> {
  if (input.cod && c.sender.type !== "INDIVIDUAL" && !c.sender.bankAccount) return { ok: false, error: "iban_required_for_cod" };
  const a = await createAddress(c, input.recipientPostcode, f);
  if (!a.ok) return a;
  const rec = await f(`${ECOM}/clients?token=${encodeURIComponent(c.token)}`, { method: "POST", bearer: c.bearer, body: { type: "INDIVIDUAL", ...splitName(input.customerName), addressId: a.id, phoneNumber: upPhone(input.customerPhone) } });
  if (rec.status !== 200 || !rec.body?.uuid) return { ok: false, error: upError(rec) };
  const price = Math.max(1, Math.round(input.totalUah));
  const body: Record<string, unknown> = {
    sender: { uuid: input.senderUuid },
    recipient: { uuid: rec.body.uuid },
    type: "STANDARD",
    deliveryType: "W2W",
    paidByRecipient: true,
    ...(input.description ? { description: input.description } : {}),
    parcels: [{ name: "Parcel", weight: Math.round(input.weightKg * 1000), length: input.length, width: input.width, height: input.height, declaredPrice: price }],
  };
  if (input.cod) {
    body.postPay = Math.max(1, Math.round(input.codUah ?? input.totalUah));
    body.postPayPaidByRecipient = true;
    if (c.sender.type !== "INDIVIDUAL") body.transferPostPayToBankAccount = true;
  }
  const r = await f(`${ECOM}/shipments?token=${encodeURIComponent(c.token)}`, { method: "POST", bearer: c.bearer, body });
  if (r.status !== 200 || !r.body?.barcode) return { ok: false, error: upError(r) };
  return { ok: true, uuid: String(r.body.uuid), barcode: String(r.body.barcode), cost: r.body.deliveryPrice != null ? Number(r.body.deliveryPrice) : null };
}

/** 100x100 label; `a4` places it on an A4 page (docs §10). */
export async function upSticker(c: UpCreds, uuidOrBarcode: string, a4: boolean, f: UpFetch = upFetch) {
  const r = await f(`${FORMS}/shipments/${encodeURIComponent(uuidOrBarcode)}/sticker?token=${encodeURIComponent(c.token)}${a4 ? "&size=SIZE_A4" : ""}`, { bearer: c.bearer, binary: true });
  return r.status === 200 && r.buffer?.subarray(0, 4).toString() === "%PDF" ? r.buffer : null;
}
