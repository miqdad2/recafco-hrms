# Live Attendance Timer — Display Contract (Web and Mobile)

| | |
| --- | --- |
| Unit | RUST-03 (contract only — **no UI was changed**) |
| Applies to | `apps/mobile` Attendance/Home screens, `apps/web` employee attendance pages |
| Data sources (existing API) | `GET /attendance-summaries/me` (official IN/OUT, status, minutes), `GET /attendance-punches/me` (raw punches with `validationStatus`, `isOfficial`, `punchTimeSource`) |

## Purpose

Show employees a running "time at work" counter without making the phone clock authoritative, without writing to the server every second, and without ever presenting unconfirmed or rejected data as official.

## Rules

1. **Start instant = the server-confirmed official IN.**
   - Use `summary.officialInTime` for today's Kuwait work date.
   - If no summary exists yet, use the latest punch of the day with `punchType = IN` and `validationStatus ∈ {ACCEPTED, ACCEPTED_WITH_WARNING}`, and label it *provisional* until the summary appears.
   - That value is the server receipt time (mobile, TIME-01) or the device event time (biometric). Never use a locally recorded tap time.
2. **The phone clock is never authoritative.** The display corrects for device clock error with a server offset:
   - `offset = serverDate − deviceNowAtResponse`, where `serverDate` is the HTTP `Date` header of the latest API response (second precision, which is sufficient for a minutes display).
   - `elapsed = (deviceNow + offset) − officialInTime`, recomputed locally once per second (or minute) for **display only**.
   - If the offset is unknown (no response yet), show the IN time but no running counter.
3. **No per-second writes.** The timer is purely presentational: no API call, storage write or database write per tick. It refreshes from the API on screen focus, on app foreground, after a punch, and on pull-to-refresh.
4. **Survives app restart.** Nothing is persisted locally except optionally the last offset. On restart, the screen fetches today's summary and punches and recomputes, so the counter is correct immediately after the first response.
5. **Biometric reconciliation.**
   - When a biometric IN/OUT syncs later, the next refresh may move the official IN earlier (an earlier biometric IN), or end the session (a biometric OUT).
   - The display always follows the latest server summary, never a locally cached start.
   - If the official IN changes, the counter jumps once; show "updated from attendance device".
6. **Active vs finalised are visually distinct.**
   - *Active*: official IN, no official OUT yet → "On duty — HH:MM elapsed (provisional)".
   - *Finalised*: official OUT present → show `totalWorkedMinutes` from the summary (the server-calculated value) and stop the counter. Never show a locally computed figure as worked time.
   - Payroll figures (late/early/overtime) come only from the summary and are labelled as calculated by the server.
7. **Rejected or pending punches are never official.**
   - A rejected IN never starts the timer.
   - A `PENDING_*` IN shows "Check-in under review", with no counter.
   - An `isOfficial=false` punch is never presented as the official IN/OUT.
8. **Missing IN or OUT is explicit.**
   - OUT without IN → "Check-out recorded, no check-in found — request a correction" (link to the existing correction request flow).
   - IN still open after the shift end plus a display threshold → "Still checked in — did you forget to check out?" (informational only; no automatic OUT).
   - A day with no punches → "Not checked in today", no counter.
9. **Overnight shifts.** Until the shift-window pairing rule is approved (see `shift-payroll-rules.md` D4), the counter continues across midnight from the official IN, but the "finalised" figures follow the server summary, which today groups by calendar day. Label it accordingly.
10. **Locked periods.** If `summary.lockedAt` is set, show "Locked for payroll" and display only server values.

## Out of scope

- No new endpoint is required. A dedicated `/attendance/today` aggregate endpoint can be proposed later to save one round trip.
- No UI implementation in RUST-03.
