import { authorizedRequest, buildQueryString, type PaginatedResult } from './client';

/**
 * Unit 21 — typed client for the existing Unit 20 payroll-lock backend
 * (apps/api/src/payroll-locks). Mutations are never retried automatically.
 */

export type PayrollLockStatus = 'OPEN' | 'LOCKED' | 'REOPENED';
export const PAYROLL_LOCK_STATUSES: PayrollLockStatus[] = ['OPEN', 'LOCKED', 'REOPENED'];

export interface PayrollLock {
  id: string;
  /** Work date stored as UTC midnight — read only the YYYY-MM-DD part. */
  periodStart: string;
  periodEnd: string;
  status: PayrollLockStatus;
  reason: string | null;
  notes: string | null;
  createdByUserId: string | null;
  lockedByUserId: string | null;
  lockedAt: string | null;
  summaryCount: number | null;
  reopenedByUserId: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollLockActionResult {
  lock: PayrollLock;
  affectedSummaryCount: number;
}

export interface ListPayrollLocksParams {
  page?: number;
  limit?: number;
  status?: PayrollLockStatus | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface CreatePayrollLockInput {
  periodStart: string;
  periodEnd: string;
  reason?: string | undefined;
  notes?: string | undefined;
}

/** `GET /payroll-locks` — newest first. Requires `payrollLocks.read`. */
export function listPayrollLocks(
  params: ListPayrollLocksParams = {},
  signal?: AbortSignal,
): Promise<PaginatedResult<PayrollLock>> {
  return authorizedRequest(`/payroll-locks${buildQueryString(params)}`, { signal: signal ?? null });
}

/** `POST /payroll-locks` — creates an OPEN period. Requires `payrollLocks.create`. 409 when it overlaps an OPEN/LOCKED period. */
export function createPayrollLock(input: CreatePayrollLockInput): Promise<PayrollLock> {
  return authorizedRequest('/payroll-locks', { method: 'POST', body: JSON.stringify(input) });
}

/** `POST /payroll-locks/:id/lock` — OPEN/REOPENED → LOCKED. Requires `payrollLocks.lock`. */
export function lockPayrollPeriod(id: string): Promise<PayrollLockActionResult> {
  return authorizedRequest(`/payroll-locks/${encodeURIComponent(id)}/lock`, { method: 'POST' });
}

/** `POST /payroll-locks/:id/unlock` — LOCKED → REOPENED with a mandatory reason. Requires `payrollLocks.unlock`. */
export function unlockPayrollPeriod(id: string, reason: string): Promise<PayrollLockActionResult> {
  return authorizedRequest(`/payroll-locks/${encodeURIComponent(id)}/unlock`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/** Unit 21.1 — readiness of an exact payroll period (backend: payroll-closing-readiness.rules.ts). */
export type ReadinessSeverity = 'BLOCKING' | 'WARNING';

export interface ReadinessIssueType {
  severity: ReadinessSeverity;
  /** Employee-days affected (period-level codes: 1). */
  employeeDays: number;
  employees: number;
}

export interface ReadinessSampleIssue {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  workDate: string;
  codes: string[];
}

export interface PayrollClosingReadiness {
  rulesVersion: string;
  periodId: string;
  periodStatus: PayrollLockStatus;
  periodStart: string;
  periodEnd: string;
  calendarDays: number;
  /** NOT payroll approval — only "no known blocking issue". */
  ready: boolean;
  employeesEvaluated: number;
  employeeDaysEvaluated: number;
  scheduledWorkingDaysKnown: false;
  blockingIssueCount: number;
  warningCount: number;
  affectedEmployees: number;
  affectedEmployeeDays: number;
  periodIssues: string[];
  issuesByType: Partial<Record<string, ReadinessIssueType>>;
  sampleIssues: ReadinessSampleIssue[];
  sampleLimit: number;
  sampleTruncated: boolean;
  evaluatedAt: string;
}

/**
 * `GET /payroll-locks/:id/readiness` — requires `payrollLocks.read`. Takes several seconds for
 * ~2,000 employees. The lock endpoint re-evaluates readiness itself; this is display only.
 */
export function getPayrollLockReadiness(id: string, signal?: AbortSignal): Promise<PayrollClosingReadiness> {
  return authorizedRequest(`/payroll-locks/${encodeURIComponent(id)}/readiness`, { signal: signal ?? null });
}
