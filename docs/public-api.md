# ONEKNIGHT public API for client websites

Base URL: `https://oneknight.pro/api/public`. Authentication: header `x-site-key: sk_…` (shown in the account, section «Сайт»). No cookies.
Browsers may call the API only from the site's own domain (`https://domain` or `https://www.domain`); server-to-server calls send no `Origin` and are allowed.

## GET /products

Active products of the site, in the order set in the account.

```json
[{ "id": "uuid", "name": "Хлібниця «Маки»", "description": "", "price": 1100, "inStock": true, "stock": 3, "photo": "/api/files/uuid" }]
```

`stock` is `null` when the product is made to order. `photo` is relative to the API origin.

## POST /orders

```json
{
  "customer": { "name": "Олена", "phone": "+380671112233", "email": "optional" },
  "items": [{ "productId": "uuid", "qty": 2 }],
  "delivery": { "method": "novaposhta", "city": "Львів", "branch": "5" },
  "payment": "cod",
  "comment": "optional"
}
```

- `delivery.method`: `novaposhta` | `ukrposhta` | `pickup` | `courier`; `payment`: `cod` | `iban` | `card`.
- Prices and names are taken from ONEKNIGHT, never from the request. Stock is reserved atomically.
- `201 { "number": 1041, "total": 2200, "status": "new" }`
- `409 { "error": "out_of_stock", "productId": "…" }` or `{ "error": "unknown_product" }`, `400 invalid_input`, `401 invalid_site_key`, `403 bad_origin`, `429` rate limit (10 orders per 10 minutes per IP).
