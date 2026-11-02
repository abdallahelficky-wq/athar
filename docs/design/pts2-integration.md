# Technotrade PTS-2 forecourt controller integration — design

Status: **design only, nothing implemented.** Written against `production` `360a580` (2026-11-02). Depends on the station-shift
COGS / reversal / corrected-shift work in PR #177 (`feature/station-cogs`, **not merged yet**) and on the Tanks & Deliveries module
(not built yet). The owner's decisions of 2026-11-02 are recorded as D-PTS1–D-PTS12 (§10) and folded into the design.

Source of protocol facts: *PTS-2 forecourt controller technical guide*, Technotrade LLC, revision R12 (17 April 2026, 233 pages).
Every protocol claim below cites the guide's page number ("page N from 233"). The guide is kept locally under `docs/vendor/pts2/`
and is **not committed** (vendor document). No official Technotrade examples or SDK were found on GitHub; the guide says the
open-source API and examples ship with the SDK kit (p. 126, p. 134). Third-party repositories exist but were not used.

**The guide does not define message formats.** All server communication uses jsonPTS, specified in a separate document,
*"jsonPTS communication protocol specification for PTS-2 controller"* (p. 110; also p. 9, p. 18, p. 20), which we do not have
yet (D-PTS8). Everything that depends on it is marked **BLOCKED: needs jsonPTS spec** and listed in §9. Nothing in this design
invents a field name, message shape or signature algorithm.

**الملخص:** أثر يصبح برنامج أتمتة المحطة لأجهزة PTS-2: يستقبل مبيعات المضخات وعدّادات الفوهات وقياسات الخزانات والتوريدات والتنبيهات
من الجهاز مباشرة، لأي شركة محطات على أثر، بإعدادات لكل شركة وعزل كامل بالمستأجر والشركة.

**المبادئ:**
- الجهاز يتصل بأثر (أثر خادم بعيد، والجهاز عميل)؛ لا حاجة لعنوان ثابت في المحطة.
- المستأجر والشركة والمحطة تُشتق من الجهاز المسجَّل فقط، لا من محتوى الرسالة.
- كل رسالة تُحفظ خاماً قبل المعالجة، والإدخال لا يتكرر.
- عدّاد الحجم الإلكتروني في الجهاز هو عدّاد الورديات المعتمد؛ صورة العدّاد الميكانيكي للتحقق فقط.
- قيمة الجهاز تُقترح على المحاسب ولا تُعتمد تلقائياً، والوردية المعتمدة لا تتغير أبداً بوصول بيانات متأخرة.
- الإيراد يبقى لترات × السعر المعتمد؛ مبالغ الجهاز للاستثناءات فقط.

---

## 1. Protocol facts from the guide

### 1.1 How the controller talks to a server
| Topic | What the guide states | Ref |
|---|---|---|
| Two channels | (a) HTTP requests uploading data from the controller to a cloud server; (b) WebSocket (RFC 6455) for full two-way communication — get/set configuration, live monitoring, reports. | p. 110 |
| Direction | The controller is the **client** in both cases, so **no static IP is needed at the station**. | p. 110 |
| Protocol | jsonPTS (proprietary) for all server communication. | p. 110 |
| Server settings | Server IPv4 (or `0.0.0.0` when the server has no static IP), domain name (resolved through the configured DNS), "server user" (credentials from the Users tab), timeout of server response. | pp. 113–114 |
| Upload types | One checkbox and its own URI each for: pump transactions, tank measurements, in-tank deliveries, GPS records, alerts, configuration, status (status also has a sending period). Plus one server port and one **secret key**. | pp. 114–115 |
| WebSocket settings | Enable checkbox, URI, port, reconnection period in seconds. | p. 115 |
| Authentication | The controller uses the stored credentials of the selected server user. **The mechanism (Basic, Digest, other) for uploads is not stated.** DIP-2 selects digest vs basic authentication, documented for the controller's own web server. | p. 114; p. 16 |
| Signature | The secret key is used "to form message signature", guaranteeing origin and that the message was not altered in transit. **Algorithm not stated.** | p. 115 |
| Transport security | "SSL/TLS 1.2" is listed under security. Technotrade's own test configuration uploads to port **80** (plain HTTP). Whether uploads support HTTPS and whether the controller validates the server certificate is not stated. | p. 9; p. 117 |
| Acknowledgement | Not described. Per upload type the controller shows a counter of stored records and a counter of already-uploaded records. | p. 114 |
| Offline buffering | Uploads require saving to the SD card to be enabled. Capacity: 100,000 pump transaction records and 100,000 tank measurement records. Behaviour when full and retry timing are not stated. | p. 9; p. 114 |
| Duplicates | The uploaded-records counter can be reset "to make the controller upload them again to the server" — **duplicates are by design**, the server must be idempotent. | pp. 114–115 |
| Identifiers | Pump transactions carry a transaction number (5 digits in the SD file example). Range, wrap and uniqueness scope are not stated. Each board has a unique identification number "used at upload of data to remote server" (24 hex characters in the example). | pp. 49, 111, 67; p. 22; p. 118 |
| Status frequency | Configurable period; the test setup uses 1 s; "data is sent each second or faster". | pp. 115, 117, 112 |
| Configuration upload | Sent automatically whenever the configuration changes. | p. 115 |
| Clock | Records are timestamped by the controller clock; NTP sync and UTC offset are configurable; battery required; gateway must be set. | pp. 23–24, 47 |
| Diagnostics | Extended logging of data upload produces `SERVER.LOG`, downloadable from the device information page. Technotrade runs a public test server (domain `technotrade.ua`, port 80, URI `jsonPTS`). | p. 116; p. 117 |

### 1.2 Data the controller provides (guide-listed fields only)
- **Pump transaction:** start and end date/time, pump, nozzle, fuel grade ID, transaction number, price, volume, temperature-
  compensated volume, amount, volume totalizer and amount totalizer at the end of the transaction, customer or attendant tag,
  ID of the management system that authorized the pump (p. 49, pp. 110–111). The SD-card file `PUMPTRN.CSV` has columns
  `DateTime, Pump, Nozzle, Transaction, UserId, Volume, Amount, Price, VolumeTotal, AmountTotal, DateTimeStart, TCVolume,
  TagLengthSymbols, Tag` (p. 67) — this is the SD file, **not** the upload format.
- **Totalizers:** "non-erasable and non-resettable and are incremented regardless the transaction is done in manual mode or
  automatically" (p. 111). Nozzle totals can be requested (p. 44, p. 78) or read automatically at the end of each filling
  (pp. 107, 150–151). The nozzle summary report compares the change in totals with dispensed volume; a mismatch means sales
  while the controller was disconnected (p. 50). Totals are **not** a separate upload type (p. 110).
- **Tank measurement:** uploaded "each time it detects a change in the product height" (p. 111); the saving threshold is a probe
  parameter (p. 51). Fields: date/time, tank, probe error, alarms (product low/high, water high), product height, water height,
  temperature, product volume, water volume, ullage, temperature-compensated volume, density, mass (p. 111). In the SD file every
  value has a "present" flag, so any value may be absent (p. 67). Tank N corresponds to probe N (p. 36).
- **In-tank delivery** (detected by the controller, even while pumps dispense — p. 84): start and end date/time, tank, start/end
  product height, water height, temperature, volume, temperature-compensated volume, density, mass (p. 112). The SD file also
  records pumps' dispensed volume during the delivery (p. 68).
- **Alerts:** pump/probe/price-board/reader offline and errors, probe level alerts, tank leakage, stuck float, absence of power,
  low battery, high CPU temperature, others (p. 112). SD file `ALERTS.CSV`: `DateTime, DeviceType, DeviceNumber, IsStarted,
  Code` — alerts have a start and an end (p. 68).
- **Status:** realtime state of pumps, probes, price boards, readers, GPS and the controller (p. 112); pump states IDLE, NOZZLE,
  FILLING, OFFLINE (p. 43).
- **Configuration:** pumps and ports (p. 27), probes (p. 28), grades with name, price and thermal-expansion coefficient (p. 34),
  tanks with grade, height, alarms and calibration chart (pp. 35–36, 68–69), nozzle → grade and tank links (p. 37), users
  (p. 42), parameters that vary by firmware (p. 29, pp. 72–74).
- **Limits:** up to 120 pumps, 20 probes/tanks, 20 grades, 10 users (p. 9). Decimal digits and units are configurable (p. 29,
  p. 80).
- The controller has its own tank reconciliation (p. 53) and automatic tank calibration (pp. 90–94); Athar does not depend on them.

### 1.3 Commands and configuration from the server
- Over the upload channel the remote server "can send any request in the controller to make any action ... or change any
  configuration (for example to update prices of the fuel grades ...)" (p. 110).
- Over WebSocket the server can get and set configuration and monitor online (p. 110).
- A price update from the server updates the pumps and the price boards (p. 113); price boards update immediately on a grades
  change (p. 98).
- Several management systems can control pumps in parallel; the controller tracks which one holds control (p. 120).

### 1.4 Firmware, network, certificates
- Keep the latest firmware (p. 23). An update can change the memory layout and the report file formats; back up the
  configuration first — **users are not included in the backup** (pp. 61–62). Parameters depend on the firmware version (p. 29).
  In-tank deliveries and alert upload arrived in R08 (2022), WebSocket in R07 (p. 6).
- No static IP at the station (p. 110). Gateway and DNS must be correct (pp. 24, 114, 117). Server port is configurable (p. 115).
- The controller's own web server: HTTP 80 / HTTPS 443 selected by DIP-1 (p. 16, p. 21), self-signed certificate (p. 21), default
  login `admin/admin` (p. 21). Each management system should have its own user (p. 42).
- SD card and battery are needed for reliable uploads (p. 17, p. 23, p. 114).
- **Automatic operation:** the controller authorizes the pump on nozzle up, closes the transaction and reads totals by itself
  (pp. 107–108). Athar is a receiving server; it does not drive the pumps in real time.

---

## 2. Entities

All tables carry `tenantId` + `companyId`; every query is scoped by both. Tenant, company and station of an inbound record are taken
**only** from the registered controller (CLAUDE.md rule 4).

| Entity | Purpose | Notes |
|---|---|---|
| `ForecourtController` | One device per station (D-PTS12): vendor `technotrade_pts2`, board unique ID (unique), station (`CostCenter`), firmware version, active flag, `lastSeenAt`, latest status JSON | Replaces the `TankGaugeDevice` placeholder of the Tanks & Deliveries design. Where the board ID appears in a request: **BLOCKED** |
| `ForecourtCredential` | Server-user login, signing secret (current and next, for rotation), rotation timestamps | Hash vs encrypted storage depends on the auth scheme: **BLOCKED** |
| `ForecourtNozzleMap` | (controller, PTS pump, PTS nozzle) → `StationNozzle` | Same station; nozzle product must equal the mapped grade's product |
| `ForecourtTankMap` | (controller, PTS tank) → `Tank` | Tank N = probe N (p. 36) |
| `ForecourtGradeMap` | (controller, PTS grade ID) → `StationFuelProduct` | |
| `ForecourtInboundMessage` | Raw payload, SHA-256, source IP, auth/signature result, processing status and error | Retention per D-PTS10 (§7) |
| `ForecourtPumpTransaction` | Guide fields (p. 111) + mapped nozzle, assigned shift, link to the raw message, price-variance flag (D-PTS5) | Unique key **BLOCKED**; fallback (controller, pump, transaction number, end time) |
| `ForecourtTotalsSnapshot` | Per nozzle: time, volume total, amount total, source `transaction_end` (p. 111) or `totals_request` | `totals_request` **BLOCKED** |
| `ForecourtTankDelivery` | Controller-detected in-tank deliveries (p. 112) | Matching to `FuelDelivery` deferred |
| `ForecourtConfigSnapshot` | Configuration uploads (p. 115) | Mapping validation; grade-price drift detection |
| `StationAlert` | Open/closed alerts per station (device silent, low stock, high water, controller alerts) | One open alert per type and subject |
| `ForecourtCommand` | Phase 2 price pushes (D-PTS4) | **BLOCKED** |

`TankReading` (Tanks & Deliveries) carries the ATG columns needed here (height, water height/volume, temperature, TC volume,
ullage, density, mass, alarms, deviceId, externalId unique per tank + source, raw payload), so this integration needs no change to it.

## 3. Ingestion

- **Routes:** one per upload type, under a dedicated router, e.g. `POST /api/integrations/pts2/v1/<type>` — the controller allows a
  separate URI per type (p. 114). No JWT; registered in the subscription write-guard and read-only route coverage tests.
- **Order of checks:**
  1. body size limit (HTTP 413) — final value **BLOCKED** (batch size);
  2. per-source-IP throttle before authentication, stored in the database (same approach as `PortalLoginThrottle`) so it holds
     across server instances;
  3. device authentication — **BLOCKED**;
  4. signature verification — **BLOCKED**; **mandatory in every environment** (D-PTS11);
  5. per-device rate limit;
  6. store the raw message;
  7. parse — **BLOCKED** — and insert records idempotently;
  8. acknowledge only after the database commit, so a failure makes the controller retry — ack format **BLOCKED**.
- Pump, nozzle and tank numbers resolve **only through that controller's mappings**. Unmapped records are stored and flagged, and
  processed when the mapping is added.
- **Status:** period 60 s (D-PTS7); store only the latest status and `lastSeenAt`, no history table.
- **Transport:** plain HTTP accepted for the pilot station only, behind a per-controller flag; HTTPS required before production
  rollout (D-PTS11). Whether the controller supports HTTPS uploads and how it validates certificates is **BLOCKED**.
- **WebSocket:** not in phase 1; considered only if commands cannot use the upload channel (**BLOCKED**).

## 4. Shift integration

### 4.1 Meter of record (D-PTS1)
- At a controller station the **PTS electronic volume totalizer** is the meter the shift chain runs on. The mechanical-counter
  photo stays as a cross-check only.
- Totalizers are non-resettable and count manual-mode dispensing too (p. 111), which is what makes them the stronger source.
- **Cutover — one transition shift** per station:
  - records both values per nozzle: the mechanical reading (as today) and the electronic totalizer;
  - its revenue and liters follow the existing (mechanical) chain, closing it;
  - its closing electronic totalizer becomes the new opening for the next shift; the chain restarts from the electronic totalizer;
  - the nozzle's meter settings (`meterType`, `meterDigits`, reading at setup) are switched to the electronic totalizer at that point,
    recorded with an audit row. Earlier shifts are not changed.

### 4.2 Values at shift boundaries
- **Boundary value:** the volume totalizer at the end of the nozzle's last transaction ending before the boundary (p. 111). In
  automatic operation every dispense is a transaction (pp. 107–108). An on-demand totals read is a later option (**BLOCKED**).
- **Transaction → shift:** a transaction belongs to the shift whose closing boundary is the first after its end time.
- **On `StationShiftReading`:** add `controllerValue`, `controllerSnapshotId`, `controllerCapturedAt`, `controllerStatus`
  (`available` / `pending` / `offline`).

### 4.3 What the accountant sees and what counts
- Photo (cross-check), controller value, and their difference; plus the controller's transaction volume compared with
  closing − opening − test liters (a gap means dispensing outside the controller, p. 50 / p. 111).
- `accountantConfirmedValue` remains the only value used. "Accept controller value" fills it and writes an audit row.
- **Policy `suggest` during the pilot** (D-PTS2): the controller value is pre-filled as a suggestion; nothing is approved
  automatically. Tolerance and a `require_match` policy are decided after one month of real data.
- Readings stay locked after approval; the meter chain rules of PR #177 apply unchanged.

### 4.4 Controller offline or late data
- Missing coverage at a boundary shows the controller value as `pending`. The controller buffers on its SD card (p. 9, p. 114), so
  the accountant can wait for the backlog or proceed with the reading entered manually.
- Data arriving after approval **never changes** an approved shift: it raises a discrepancy alert on the shift; correction goes
  through reverse shift + corrected shift (PR #177).
- Test liters stay a manual entry — the guide does not say test dispenses can be told apart.

### 4.5 Revenue (D-PTS5)
- Posting stays liters × `FuelPrice`, exactly as `computeShiftClosing` does today.
- Controller amounts and prices are **never posted**. A transaction whose price differs from the approved `FuelPrice` for its
  product and date is flagged as a variance exception ("pump selling at a non-approved price") on the shift review screen and in
  station alerts.

## 5. Tanks
- Each tank measurement becomes a `TankReading` with `source = atg`; idempotency key = record ID (**BLOCKED**) or, until known,
  (tank, measurement time).
- Controller-detected deliveries are stored in `ForecourtTankDelivery`; matching them to `FuelDelivery` is deferred.
- The controller's volume (from its calibration chart, p. 31, p. 36) is stored as delivered, with the height; for controller
  stations the controller's calibration is the master.

## 6. Alerts
- **Device silent:** no message from the controller for **10 minutes** (D-PTS7; company setting), checked by the existing scheduler.
  The default is 10× the 60 s status period.
- **Low stock / high water:** computed by Athar from the latest `TankReading` against per-tank thresholds, plus the controller's own
  measurement alarms (p. 111).
- **Controller alerts:** stored with start and end (p. 68); code meanings **BLOCKED**.
- **Price variance** (D-PTS5) as in §4.5.
- Shown on the station dashboard.

## 7. Retention (D-PTS10)
- Processed records (transactions, totals snapshots, tank readings, deliveries, alerts) are kept permanently.
- Raw inbound payloads are kept **90 days** in the database, then archived to the existing Cloudflare R2 storage
  (`src/lib/storage.ts`) and removed from the database. The period is a configurable setting.
- The archive keeps the SHA-256 and the controller/tenant/company identifiers so an archived payload can be traced to its records.

## 8. Security
- One server user per controller (p. 42); Athar holds the controller's admin credentials and the default `admin/admin` is changed
  at onboarding (p. 21; D-PTS3).
- Signing secrets stored encrypted (same pattern as the ZATCA secrets), because verification needs the raw secret.
- Secret rotation: current and next secret accepted during an overlap window while the technician updates the controller; audited.
- Per-IP and per-device rate limits; body size limit.
- Signature verification mandatory everywhere; plain HTTP only on the pilot flag (D-PTS11).
- Audit: registration, mapping changes, secret rotation, cutover, acceptance of controller values, price pushes (phase 2).
- **CLAUDE.md rule 1 (mirror / reverse):** ingested records never post journal entries. Reversing a shift unlinks its controller
  transactions and the corrected shift relinks them; no controller data is deleted or copied, so nothing leaks through a
  reversal or a mirror. **Rule 4:** isolation tests with two tenants whose companies share a name.

## 9. BLOCKED: what we need from the jsonPTS spec
1. Request format per upload type: method, content type, JSON structure, field names, units, decimals, timestamp format and time zone.
2. Where the board unique ID appears in a request.
3. The authentication scheme used for the server user on uploads.
4. The signature: algorithm, exactly which bytes are signed, encoding, where it is carried, and whether it includes a timestamp
   or nonce (replay protection).
5. The server response / acknowledgement: what marks records as uploaded, partial acceptance, error codes, retry interval and
   backoff, records per request, maximum payload size.
6. Record identifiers per type; transaction number range, wrap and reset behaviour; whether a re-upload after a counter reset
   carries identical identifiers.
7. How commands are sent over the upload channel versus WebSocket: set grade prices, read totals, get/set configuration, and their
   confirmations.
8. WebSocket handshake, authentication, framing and heartbeat.
9. Status payload contents.
10. Alert code table (DeviceType and Code).
11. Configuration payload structure (grades, nozzles, tanks, pumps).
12. HTTPS client support for uploads: certificate validation, SNI, TLS versions, minimum firmware.
13. Which firmware versions support which features.
14. The Postman collection referred to in the guide (p. 153).

Contact: support@technotrade.ua (p. 7). Spec requested (D-PTS8).

## 10. Owner decisions (2026-11-02)
- **D-PTS1 Meter of record.** The PTS electronic volume totalizer at controller stations; the mechanical-counter photo is a
  cross-check only. Cutover uses one transition shift recording both values; the meter chain restarts from the electronic
  totalizer (§4.1).
- **D-PTS2 Reading policy.** `suggest` during the pilot; tolerance and `require_match` to be set after one month of real data.
- **D-PTS3 Remote server.** Athar is the controller's only remote server from day one; Athar holds the admin credentials. No vendor
  software.
- **D-PTS4 Price push.** Deferred to phase 2.
- **D-PTS5 Revenue.** Stays liters × `FuelPrice`. Controller amounts appear only as a variance exception (pump selling at a
  non-approved price), never used for posting.
- **D-PTS6 RFID attendant tags.** Deferred.
- **D-PTS7 Status and silence.** Status period 60 s; "device silent" alert after 10 minutes (company-configurable).
- **D-PTS8 Spec and SDK.** jsonPTS spec being requested from Technotrade; SDK purchase pending a quotation.
- **D-PTS9 Dispensers with more than two nozzles.** Pending a field survey — **open question** (§12).
- **D-PTS10 Retention.** Processed records kept permanently; raw payloads 90 days in the database, then archived to Cloudflare R2;
  period configurable.
- **D-PTS11 Transport.** Plain HTTP uploads acceptable for the pilot only, with mandatory signature verification; HTTPS required
  before production rollout.
- **D-PTS12 Scope.** One controller per station; pilot at a single station.

## 11. Phases (each a separate PR)
- **P0 — prerequisites:** PR #177 merged; Tanks & Deliveries module built; jsonPTS spec received; SDK or pilot controller available.
- **P1 — registration and ingestion:** controller, credentials, mappings, raw store, pump transactions, totals snapshots, tank
  readings, alerts, status and device-silent alert. Parser built from the spec, tested with payloads captured from a real
  controller (`SERVER.LOG`, p. 116) — captured payloads are external inputs under CLAUDE.md rule 2.
- **P2 — shift integration:** controller values on readings, `suggest` policy, transition-shift cutover, price-variance exceptions,
  late-data discrepancy alerts.
- **P3 — pilot hardening:** HTTPS, raw-payload archive to R2, retention job, secret rotation UI.
- **Phase 2 (later):** price push (D-PTS4), `require_match` policy (D-PTS2), RFID tags (D-PTS6), delivery matching, WebSocket if needed.

**Testing without hardware (until P1):** a domain-level simulator that produces parsed records using only the guide's documented
fields and behaviour (pp. 110–112, 67–68), fed into the ingestion service below the jsonPTS parser; tests check the real outputs
(`TankReading` rows, shift pre-fill, alerts). The SDK kit includes UniPump/UniProbe simulators (pp. 128–133) and the controller has
built-in pump and probe simulators (pp. 63–66). Note that simulator totals reset to zero on controller restart (p. 63).

## 12. Open questions
1. **Dispensers with more than two nozzles (D-PTS9):** Athar models a pump as exactly two nozzles (`NOZZLE_PRODUCTS` in
   `src/modules/stationSetup/stationSetup.service.ts`). Mapping is per nozzle, but a dispenser with more nozzles cannot be modelled
   today. Pending the field survey.
2. Everything in §9 until the jsonPTS spec arrives.

## 13. Migrations (proposed, all additive)
1. `forecourt_controllers` and credentials
2. nozzle, tank and grade mapping tables
3. `forecourt_inbound_messages`
4. `forecourt_pump_transactions`
5. `forecourt_totals_snapshots`
6. `forecourt_tank_deliveries`
7. `forecourt_config_snapshots`
8. `station_alerts`
9. controller columns on `station_shift_readings`; cutover audit on nozzles
10. company settings: reading policy, device-silent minutes, raw-payload retention days
11. `forecourt_commands` (phase 2)

Tank tables (`Tank`, `TankReading` with the ATG columns, `FuelDelivery`) belong to the Tanks & Deliveries module and are not
repeated here.
