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
