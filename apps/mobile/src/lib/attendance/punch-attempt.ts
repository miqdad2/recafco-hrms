import * as Crypto from 'expo-crypto';
import { ApiError } from '../api/client';
import type { CreateMobilePunchInput } from '../api/attendance-punches';

/**
 * TIME-01 retry safety. One `PunchAttempt` = one intentional tap on Check In / Check Out.
 *
 * - A new attempt gets a fresh `clientRequestId`.
 * - If the request may or may not have reached the server (network failure, timeout, 5xx), the
 *   attempt is kept and the NEXT tap of the same button resends the identical payload — same id,
 *   same GPS reading. The server then returns the original stored punch instead of recording a
 *   second one (and a changed payload under the same id would be refused with 409).
 * - Any definitive server answer (2xx or 4xx) ends the attempt.
 * - Attempts are kept in memory only and expire after PUNCH_ATTEMPT_MAX_AGE_MS; after that (or
 *   after an app restart) a tap starts a new attempt and the server's duplicate window applies.
 */
export const PUNCH_ATTEMPT_MAX_AGE_MS = 10 * 60_000;

export interface PunchAttempt {
  input: CreateMobilePunchInput;
  createdAtMs: number;
}

export function createPunchAttempt(input: Omit<CreateMobilePunchInput, 'clientRequestId'>): PunchAttempt {
  return { input: { ...input, clientRequestId: Crypto.randomUUID() }, createdAtMs: Date.now() };
}

/** The pending attempt to retry for this button, or null if a new attempt must start. */
export function reusablePunchAttempt(pending: PunchAttempt | null, punchType: 'IN' | 'OUT'): PunchAttempt | null {
  if (!pending || pending.input.punchType !== punchType) {
    return null;
  }
  return Date.now() - pending.createdAtMs <= PUNCH_ATTEMPT_MAX_AGE_MS ? pending : null;
}

/** True when the server may not have processed the request, so it must be retried with the SAME id. */
export function isOutcomeUnknown(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return true;
  }
  return error.status === 0 || error.status >= 500;
}
