# Packeta API — notes for Picklo

Source: https://docs.packeta.com (read 2026-10-10). Summary of what Picklo uses.

## Credentials (client.packeta.com → User Support)
- **API key** — 16 characters. Pickup-point feeds and tracking.
- **API password** — 32 characters. Every REST/XML method (`createPacket`, labels, cancel, claims).
- **Sender indication** (`eshop`) — name of the sender in the client section; required when the account has several senders.
- No sandbox: test with the production account (no charge until a packet physically enters the network).

## Endpoints
- REST/XML: `POST https://www.zasilkovna.cz/api/rest` — root element = method name, response `<response><status>ok|fault</status><result>…`.
- Feeds (JSON), `https://pickup-point.api.packeta.com/v5/{API_KEY}/…`:
  - `branch/json` (Packeta points), `box/json` (Z-BOX, `codAllowed`), `carrier/json` (carriers; home delivery = carrier id), `carrier_point/json` (carriers' own points).
  - Filters: `country=RO` (not on carrier list), `lang=en`. Send `Accept-Encoding: br`; per-country feeds are ≤ ~1.4 MB. `409` = feed being generated, retry later.
  - Refresh at least daily (recommended 4×/day 07–21).
- Tracking page: `https://tracking.packeta.com/{lang}/?id={packetId}`.

## createPacket — PacketAttributes (subset)
`number` (1-36), `name`, `surname` (1-32 each), `email` or `phone`, `addressId` (Packeta point / Z-BOX id **or** carrier id for home delivery), `currency` (CZK, EUR, HUF, PLN, RON), `cod` (2 decimals; whole for CZK; multiple of 5 for HUF), `value` (required), `weight` kg (required), `eshop`, `note` (≤128), home delivery: `street`, `houseNumber`, `city`, `zip`, `province`; carrier point: `carrierPickupPoint`; `size {length,width,height}` mm for some carriers. No country field — country comes from `addressId`.
Response: `<result><id>…</id><barcode>Z…</barcode><barcodeText>Z 123 …</barcodeText></result>`.

## Romania carriers (carrier overview)
RO Home Delivery HD **4161** (best carrier, max 5 kg) · RO FAN Courier HD 762 · RO Cargus HD 590 · RO Sameday HD 7397 · RO FAN Box 32428 · RO Sameday Box 7455 · RO Romanian Post HD 39233 / PP 39234. RO Packeta PUDO and Z-BOX: point ids from feeds.

## Labels
- Packeta label (points, Z-BOX): `packetLabelPdf(packetId, format, offset)`, `packetsLabelsPdf`. Formats: `A6 on A6`, `A7 on A7`, `A6 on A4`, `A7 on A4`, `105x35mm on A4`, `A8 on A8`. Base64 PDF.
- Carrier label (home delivery, carrier `apiAllowed`): `packetCourierNumberV2(packetId)` → `packetCourierLabelPdf(packetId, courierNumber)` (A6 only). If not allowed, the Packeta label is used and the parcel is relabelled for free.

## Tracking
`packetTracking(packetId)` → StatusRecords (`dateTime`, `statusCode`, `codeText`, `statusText`, `branchId`, `externalTrackingCode`); `packetStatus` (current, `isReturning`, `storedUntil`); `packetCourierTracking` (external carrier: `dateTime`, `statusCode`, `externalStatusName`). Packeta syncs carriers 3×/day.
Status codes: 1 received data · 2 arrived · 3 prepared for departure · 4 departed · 5 ready for pickup · 6 handed to carrier · 7 delivered · 9 posted back · 10 returned · 11 cancelled · 12 collected · 16 delivery attempt · 17/18 rejected by recipient · 19 return from HD · 20 storage time expired · 22 return overlimit · 23 Z-BOX delivery attempt · 24 Z-BOX last attempt · 25 carrier first delivery attempt.

## Cancel / returns
- `cancelPacket(packetId)` — only before physical consignment.
- Returns: `createPacketClaimWithPassword({ number, email, phone, value, currency, eshop, consignCountry, sendEmailToCustomer })` → `PacketDetail` with `password`; the customer drops the parcel at any Packeta point / Z-BOX with that password. Return destination = billing address in the client section.

## Live check (2026-10-10)
- Z-BOX, Packeta point, home delivery via 4161 (RO Home Delivery) and via 762 (FAN HD): createPacket, label PDF, tracking, cancelPacket all work.
- COD is refused until the Packeta account has a RON bank account (or currency conversion) — fault on field `cod`.
- `createPacketClaimWithPassword` requires `eshop` (sender label from client.packeta.com → Senders).
