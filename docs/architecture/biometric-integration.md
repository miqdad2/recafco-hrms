# Biometric Attendance Integration — Audit Status and Read-Only Connector Architecture

| | |
| --- | --- |
| Unit | RUST-04 — Biometric Database Integration and Identity Mapping Audit |
| Date | 2026-11-08 |
| **Source access** | **NONE.** RECAFCO IT has not yet provided connection details, credentials or schema documentation for the biometric attendance database. **No connection was attempted.** No credentials were searched for or extracted. |
| What exists | A synthetic, source-agnostic connector core (`apps/attendance-engine/src/biometric/`), 21 synthetic tests, and this design. |
| What does NOT exist | Any verified fact about the real source database, any live connector, any import of real records. |

This document is for RECAFCO IT, the HRMS engineers, and HR (for identity-mapping governance). **Everything below marked SYNTHETIC or PROPOSED is unverified against the real system.**

---

## 1. Confirmed facts vs unknowns

| Item | Status |
| --- | --- |
| Biometric machines exist at several RECAFCO work locations | Stated by RECAFCO (unit brief) |
| Machines store attendance in a separate database that Pinnacle HRMS reads | Stated by RECAFCO (unit brief) |
| Pinnacle must keep operating unchanged while the new HRMS reads the same records | Requirement |
| Database engine and version | **Unknown.** Not assumed to be PostgreSQL; could be SQL Server, MySQL/MariaDB, PostgreSQL, MS Access, or a vendor file or SDK store |
| Host, port, network path, authentication method | **Unknown** |
| Read-only account availability | **Unknown** |
| Tables/views, field names and types | **Unknown** |
| Employee identifier stored by devices (employee code vs device user number) | **Unknown** (long-standing tracker question; finding F8) |
| Event identifier uniqueness (global, per device, per database, reset behaviour) | **Unknown** |
| Direction (explicit IN/OUT, device role, none) | **Unknown** |
| Timestamp representation (local vs UTC, device vs insertion time) | **Unknown** |
| Existing sync mechanism (vendor service push, pull, schedule) | **Unknown** |
| Device vendors and models | **Unknown** (open since project start) |

### What exists on the HRMS side today (verified in code)

- `AttendanceDevice` stores `deviceCode`, `serialNumber` (unique), `vendor`, `model`, `ipAddress`, `port`, `connectionMode` (`NETWORK_PULL`/`API`/`DATABASE_SYNC`/`FILE_IMPORT`/`MANUAL_IMPORT`/`UNKNOWN`), `workLocationId`, `lastSyncAt` and `isActive`.
- `POST /attendance-punches/device-import` is a **single-record** JSON import: `attendanceDeviceId`, `sourceId?`, `employeeCode`, `punchType` (IN/OUT required), `punchTimeSource`.
  - It is idempotent on the DB unique constraint `(attendanceDeviceId, sourceId)`, returning the existing row.
  - It stores `punchTimeServer` = import time, and the event time stays in `punchTimeSource`.
  - Validation is the device path of RUST-02.
- Current duplicate rule (RUST-02 V44): any earlier punch with the same `sourceId` (same employee/type/source) is a duplicate **regardless of device and time**.

---

## 2. Information RECAFCO IT must provide (blocking)

1. **Engine and version**, host and port, network path from the HRMS server (LAN/VPN), and TLS support.
2. A **dedicated read-only login**, created by IT, scoped to the attendance-event table(s)/view(s) only, with no access to template or enrolment-biometric tables. If possible, provide it through a **view** that exposes only the fields in §3.
3. **Schema documentation** of the attendance-event table: column names and types, the primary key, any auto-increment or sequence column, and indexes, especially on the sequence or insertion-time column.
4. **Event identity**: is there a device log number? Is it unique per device, and does it reset after a device clear or firmware update? Is the database row id stable?
5. **Employee identity**: which field holds the person (device user number, enrolment number, badge, or employee code)? Is the same person's number identical on every machine? Are numbers ever reused?
6. **Direction**: is there an IN/OUT/status column and its code list (including break and overtime codes), or are terminals entry-only or exit-only?
7. **Time**: is the event time stored as device-local or UTC? Is a separate insertion or upload time stored? Are device clocks NTP-synchronised, and how is drift handled today?
8. **Sync behaviour**: how and how often the vendor service moves logs from devices into the database, what happens when a device is offline, and whether records are ever **updated or deleted** after insertion (corrections).
9. **Load windows**: when Pinnacle reads the database, and acceptable query frequency and limits during the morning and evening peaks.
10. The **device inventory**: serial, location, vendor/model, and role (entry, exit, both).

---

## 3. Field mapping (template — to be filled once the schema is confirmed)

| Connector field (`SourceEvent`) | Meaning | Real source column |
| --- | --- | --- |
| `sourceSequence` | Monotonic cursor (identity/auto-increment) | *TBD by IT* |
| `sourceRowId` | Primary key | *TBD* |
| `deviceSerial` | Terminal serial / id | *TBD* |
| `deviceLocalEventId` | Device's own log number | *TBD (may not exist)* |
| `enrollmentNumber` | Person id as stored by the device | *TBD* |
| `eventTimeLocal` / `eventTimeUtc` | Event time (local wall clock, or an absolute instant) | *TBD* |
| `directionRaw` | Raw IN/OUT/status code | *TBD (may not exist)* |
| `sourceRecordedAt` | Database insertion/upload time | *TBD (may not exist)* |
| `verifyMode` | Verification method label only | *optional* |

**Never read**: fingerprint/face/palm templates, face photos, card secrets, PINs, or any enrolment biometric data. `SourceEvent` has no field for them and rejects unknown fields (tested).

Vendor products commonly keep a single "transaction"/"check-in-out" table with a person number, a timestamp, a status/direction code and a terminal serial. **This pattern is only a hint for the IT conversation; nothing here assumes RECAFCO's product or schema.**

---

## 4. Employee identity mapping (PROPOSED — needs a Prisma migration in a later unit)

The proposed table `biometric_identity_mappings` (Prisma-owned):

| Column | Purpose |
| --- | --- |
| `id`, `sourceSystem` | Which biometric source |
| `deviceSerial` (nullable) | `NULL` = valid on all devices of the source; set = this device only |
| `enrollmentNumber` | Person id as stored by the source |
| `employeeId` (FK) | HRMS employee |
| `effectiveFrom`, `effectiveTo` (exclusive, nullable) | Effective dating; history is end-dated, never overwritten |
| `createdByUserId`, `reason`, timestamps | Who and why; every change also writes `AuditLog` (before/after) |

Rules (implemented and tested in `biometric/identity.rs`):
- **No name matching, ever.** Initial mappings come from an IT/HR-reviewed export and are loaded by an audited admin action.
- A **device-scoped** mapping beats a source-wide one, so the same enrolment number on two machines can be two people.
- Resolution uses the **event time**: transfers and re-enrolment of a reused number resolve historically correctly.
- **Zero matches → `UNMAPPED_EMPLOYEE`; several at the same scope → `AMBIGUOUS_EMPLOYEE_MAPPING`.** Both are held in an exception queue and re-processed after the mapping is fixed, keeping the same idempotency key.
- A unique constraint prevents overlapping active rows per `(sourceSystem, deviceSerial, enrollmentNumber)`. The application layer enforces non-overlapping date ranges.

---

## 5. Event identity and duplicates (PROPOSED, tested synthetically)

The idempotency key is used as the HRMS `sourceId`, always **scoped** (`biometric/event_key.rs`). In order of preference:
1. `bio:{source}:dev:{serial}:log:{deviceLogId}:{eventUtcMs}`: a device log number scoped to its device. The instant is appended so a log number **reused after a device reset** creates a new key, while a re-read of the same row does not.
2. `bio:{source}:row:{sourceRowId}`: the source database's own primary key.
3. `bio:{source}:dev:{serial}:emp:{enrolment}:{eventUtcMs}:{direction}`: a content key when the source has no identifiers.

Consequences:
- Re-reads, overlap windows and full re-syncs are absorbed by the existing `(attendanceDeviceId, sourceId)` unique constraint.
- The **RUST-02 V44 collision is avoided without changing duplicate policy**. Test S06 proves this with the RUST-02 engine: a raw log number `5001` from two devices would make the second punch `REJECTED_DUPLICATE`, while scoped keys are `ACCEPTED`.
- The exact key choice is made once IT confirms §2.4. **The current duplicate policy is not changed in this unit.**

---

## 6. Timestamps (PROPOSED, tested synthetically)

- The **original device event time** becomes `punchTimeSource` (official). The connector's sync time is recorded separately (`syncedAt`), and NestJS also stores its own receipt time in `punchTimeServer`. Event time is **never** replaced by import time.
- If the source stores an absolute instant, it is used as is. Otherwise device-local wall-clock time is converted with the **device's configured UTC offset** (Kuwait +180 min), never the server's timezone.
- **Delayed sync** (more than 30 min between event and sync) adds the informational `DELAYED_SYNC` flag; the event is imported with its original time. A late event into a **locked** payroll period is still stored and flagged by NestJS (`LOCKED_PERIOD_LATE_PUNCH`, existing behaviour).
- **Device clock ahead**: an event time later than the source's own recording time by more than 5 min is impossible unless the device clock is wrong. Such events are **held** (`DEVICE_CLOCK_AHEAD`), not imported.
  - A clock running **behind** can't be detected from one event. That needs periodic device-clock monitoring (vendor API/service), and IT input is required.
- **Out-of-order events**: the import order doesn't matter, because summary selection is by event time (RUST-03, verified order-independent).
- **Corrected or updated source rows**: unknown whether the source ever updates rows; to be confirmed by IT. If it does, an `updatedAt`/rowversion cursor and a correction policy are required (never silent overwrite: raw punches are append-only).

---

## 7. Punch direction

| Source behaviour | Connector rule |
| --- | --- |
| Explicit code column | Map only the IT-documented code lists to IN/OUT. Any other code (break, overtime, unknown) → held `DIRECTION_CODE_UNRECOGNISED`. |
| Device role (entry-only/exit-only terminal) | Configured per device (`FixedIn`/`FixedOut`) from the IT device inventory. |
| Timestamp-only / alternating devices | **Held `DIRECTION_UNKNOWN`. Never inferred from order or alternation.** The existing import contract requires IN/OUT, and inference is a payroll policy needing explicit HR approval. Options for HR: shift-window rule (first-in-window = IN, last = OUT), alternating, or manual review. |

---

## 8. Connector architecture (PROPOSED)

```text
 Biometric source DB (vendor-managed, Pinnacle also reads it)
        │  READ-ONLY login, indexed range query on the sequence column, small batches
        ▼
 Connector worker (runs on the HRMS server; separate process; never in the punch request path)
   - SourceReader (engine-specific, read-only)        ← chosen after IT confirms the engine
   - classify: device → event time → clock → identity → direction  (biometric/connector.rs)
   - checkpoint store (last fully handled sequence), exception queue (held events)
        │  service account, existing idempotent contract
        ▼
 NestJS POST /attendance-punches/device-import  →  raw punch + RUST-02 validation + RUST-03 summary
```

- **Read path**:
  - Query: `WHERE seq > :checkpoint - overlap ORDER BY seq LIMIT :batch`, on an indexed column.
  - Batch 500, an overlap of 50 rows, and at most 20 batches per run.
  - A pool of 1–2 connections, a statement timeout, and no transactions holding locks (read-committed snapshot or `READ ONLY` where the engine supports it).
  - Never a full-table scan, never triggers, tables or indexes on the source, and never writes.
- **Schedule**: every 1–2 min during the punch peaks (06:00–08:30 and 15:30–18:00 Kuwait time, to be confirmed), every 5–15 min otherwise. Coordinate with IT so the load stays below what Pinnacle needs.
- **Restart safety**: the checkpoint advances only past fully handled events. Source or sink failure returns the last durable checkpoint, and the retry re-imports nothing (tests S15 and sink-failure).
- **Exception queue**: held events (unknown device or employee, ambiguous mapping, unknown direction, clock ahead, missing time) are shown to HR/IT and re-processed after a fix, with the same key.
- **Technology choice**: depends on the engine, which is not yet known.
  - SQL Server → Rust `tiberius` or a .NET/Node worker.
  - MySQL/PostgreSQL → Rust `sqlx`.
  - MS Access → Windows ODBC or file export. Rust is a poor fit.
  - Vendor SDK/COM → the vendor-supported runtime; Rust is not forced.
  - The pure classification core is reusable either way: as a Rust library or as a ported spec with the same tests.
- **Prerequisite NestJS changes** (a later, separately approved unit):
  - a batch device-import endpoint for a dedicated service account;
  - store `syncedAt`, `sourceRecordedAt`, `deviceSerial`, `enrollmentNumber` and connector flags in `rawPayload`;
  - the identity-mapping table and admin UI;
  - checkpoint and exception-queue tables;
  - device-health fields.

---

## 9. Synthetic test results (`apps/attendance-engine/tests/biometric_connector_test.rs`)

**All 21 passed. These are synthetic records; they verify connector logic only, not the real source.**

| # | Scenario | Result |
| --- | --- | --- |
| 1 | Normal biometric IN | Imported. 07:00 Kuwait → 04:00Z event time; sync time separate; scoped key |
| 2 | Normal biometric OUT | Imported as OUT |
| 3 | Mobile IN + biometric OUT | One RUST-03 summary, PRESENT, both sources preserved |
| 4 | Biometric IN + mobile OUT | Same |
| 5 | Duplicate import / re-read / duplicated source row | One punch; the rest `AlreadyExists` |
| 6 | Same log number on two devices | Two distinct keys, both imported. RUST-02 proves raw ids would collide (V44). |
| 7 | Unknown employee | Held; the checkpoint advances; imported after the mapping is added (same key) |
| 8 | Unknown device | Held |
| 9 | Delayed sync | Event time kept; `DELAYED_SYNC` flag |
| 10 | Device clock drift | 2.5 h ahead held; 3 min ahead tolerated |
| 11 | Offline device resync (50 events over 3 days) | All imported with original times, across bounded batches |
| 12 | Out-of-order events | Identical summary in any order |
| 13 | Overnight attendance | Correct instants; the current summary splits the days (D4, unchanged) |
| 14 | Missing or unknown direction | Held, never inferred |
| 15 | Source temporarily unavailable | Stops at the last handled event; the retry imports each event exactly once, and only the overlap is re-read |
| + | Identity mapping | Device-scoped, transfer effective dating, ambiguous held |
| + | Inactive device; sink failure; restart from a persisted checkpoint; incremental reads; template data rejected; source UTC instant precedence | All pass |

---

## 10. Security and performance

- **Security:**
  - A dedicated read-only login (ideally view-only) per environment, with credentials in the deployment secret store and never in Git.
  - Network ACL from the HRMS server only, and TLS where the engine supports it.
  - Minimum columns read; no biometric templates; no personal data beyond the enrolment number.
  - An HRMS service account limited to `attendancePunches.createDeviceImport`.
  - Every mapping change is audited.
- **Volume:**
  - 2,000 employees × about 4 events/day ≈ 8,000 events/day.
  - A peak of perhaps 2,000 events in 30 minutes is about 4 batches of 500.
  - The import cost is dominated by the NestJS validation and summary write per punch. Pure Rust validation and summary costs are microseconds (RUST-02/03 benchmarks).
- **Monitoring** (Uptime Kuma, later Prometheus):
  - sync lag (now − newest imported event) per source and device;
  - consecutive read failures;
  - held-queue size by reason;
  - devices silent beyond N hours during working days;
  - clock-ahead holds;
  - the import error rate.

---

## 11. Recommended next implementation unit

**BIO-01 — Biometric Source Read-Only Connection (after IT provides §2):**
1. IT creates the read-only login and view, and documents the schema.
2. Confirm the engine. Choose the reader technology.
3. Implement the read-only `SourceReader`. Run it **against a copy or replica first**, then read-only against the live source, with a dry-run mode that classifies and reports but **imports nothing**.
4. Produce a reconciliation report against Pinnacle for a sample period: counts per device, per day and per employee, unmapped enrolments, and unknown directions.
5. Only then design the HRMS-side tables (identity mapping, checkpoint, exception queue) as a reviewed Prisma migration.
