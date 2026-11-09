import { createHash } from 'node:crypto';
import type { CreateMobilePunchDto } from './dto/create-mobile-punch.dto';

/**
 * TIME-01 idempotency fingerprint: SHA-256 over every request field that influences validation.
 * A retry carrying the same `clientRequestId` must produce the same fingerprint, otherwise it is a
 * conflicting reuse (e.g. resending a rejected outside-geofence punch with edited coordinates, or
 * with `mockLocationDetected` flipped to false) and is refused with 409.
 *
 * Deliberately excluded: `clientReportedTime` / legacy `punchTimeSource` (diagnostic only, may
 * legitimately differ between retries) and `appVersion` (does not affect validation).
 */
export function mobilePunchFingerprint(dto: CreateMobilePunchDto): string {
  const material = {
    punchType: dto.punchType,
    deviceIdentifier: dto.deviceIdentifier,
    workLocationId: dto.workLocationId ?? null,
    latitude: dto.latitude ?? null,
    longitude: dto.longitude ?? null,
    gpsAccuracy: dto.gpsAccuracy ?? null,
    wifiSsid: dto.wifiSsid ?? null,
    wifiBssid: dto.wifiBssid ?? null,
    selfieFileId: dto.selfieFileId ?? null,
    fraudSignals: dto.fraudSignals ?? null,
  };
  return createHash('sha256').update(canonicalJson(material)).digest('hex');
}

/** JSON with object keys sorted recursively, so key order in the client payload cannot change the hash. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
