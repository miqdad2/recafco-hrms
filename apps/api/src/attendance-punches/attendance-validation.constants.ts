/**
 * A mobile GPS fix at or below this accuracy radius (meters) is trusted enough to be part of an
 * automatic accept decision. Matches the mobile app's own client-side pre-check
 * (`apps/mobile/src/lib/location/location-service.ts`'s `MAX_ACCEPTABLE_ACCURACY_METERS`, Unit
 * 17) — this is the production threshold, replacing an earlier, more conservative 50m
 * dev-mode-only value that predated this unit's automated validation.
 */
export const MOBILE_GPS_ACCURACY_MAX_METERS = 100;

/**
 * Two punches from the same employee/punchType/sourceType within this many minutes of each
 * other (by source-reported time) are treated as duplicates of one another.
 */
export const DUPLICATE_WINDOW_MINUTES = 2;

/**
 * TIME-01: if the phone's reported clock differs from the server receipt time by more than this,
 * an informational `CLIENT_CLOCK_SKEW` flag is recorded. It never changes the official time,
 * the validation status or the fraud score — it is a diagnostic/security signal for HR review.
 */
export const CLIENT_CLOCK_SKEW_FLAG_SECONDS = 300;

/** TIME-01: how long an idempotent retry waits for the original, still-in-flight request to finish validation. */
export const IDEMPOTENT_REPLAY_WAIT_MS = 5_000;

/**
 * TIME-01: a stored mobile punch still unvalidated this long after receipt is treated as an
 * interrupted request (process crashed between insert and validation); a retry with the same
 * clientRequestId then resumes processing for it instead of returning the placeholder state.
 */
export const IDEMPOTENT_RECOVERY_STALE_MS = 30_000;
