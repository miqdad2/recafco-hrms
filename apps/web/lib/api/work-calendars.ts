import { authorizedRequest, buildQueryString, type PaginatedResult } from './client';

/**
 * HR-POLICY-01 — typed client for apps/api/src/work-calendars (shapes taken from the backend).
 * DRAFT records never affect attendance; only ACTIVE (approved) ones do.
 */

export type CalendarPolicyStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE';
export type CalendarAssignmentScope = 'EMPLOYEE' | 'SHIFT';
export type CalendarDayType = 'WORKING_DAY' | 'REST_DAY';
export type DayClassification = 'NOT_EMPLOYED' | 'SCHEDULED_WORKDAY' | 'REST_DAY' | 'PUBLIC_HOLIDAY' | 'APPROVED_LEAVE' | 'UNKNOWN';

export interface WorkCalendar {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** 0 = Sunday … 6 = Saturday */
  workingWeekdays: number[];
  status: CalendarPolicyStatus;
  approvalReference: string | null;
  activatedByUserId: string | null;
  activatedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  currentAssignments?: { employees: number; shifts: number };
}

export interface CalendarAssignment {
  id: string;
  calendarId: string;
  scope: CalendarAssignmentScope;
  employeeId: string | null;
  shiftId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  endedAt: string | null;
  createdAt: string;
  calendar: { id: string; code: string; name: string };
  employee: { id: string; employeeCode: string; firstName: string; lastName: string } | null;
  shift: { id: string; name: string; code: string | null } | null;
}

export interface DayOverride {
  id: string;
  calendarId: string | null;
  employeeId: string | null;
  date: string;
  dayType: CalendarDayType;
  reason: string;
  status: CalendarPolicyStatus;
  approvalReference: string | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  calendar: { code: string; name: string } | null;
  employee: { employeeCode: string; firstName: string; lastName: string } | null;
}

export interface PublicHoliday {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: CalendarPolicyStatus;
  source: string | null;
  notes: string | null;
  approvalReference: string | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  createdAt: string;
}

export interface CalendarDayResolution {
  classification: DayClassification;
  scheduledWork: boolean | null;
  scheduledMinutes: number | null;
  source: string;
  calendar: { id: string; code: string; name: string } | null;
  holiday: { id: string; name: string } | null;
  overrideId: string | null;
  policyVersion: string;
  warnings: string[];
  conflicts: string[];
}

export interface CalendarPreview {
  calendar: WorkCalendar;
  month: string;
  policyVersion: string;
  isDraft: boolean;
  days: { date: string; classification: DayClassification; source: string; holiday: { id: string; name: string } | null; overrideId: string | null; warnings: string[] }[];
}

export interface EmployeeCalendarPreview {
  employee: { id: string; employeeCode: string; name: string; workLocation: string | null };
  month: string;
  policyVersion: string;
  leaveIntegration: 'AVAILABLE' | 'NOT_AVAILABLE';
  days: { date: string; resolution: CalendarDayResolution; shift: { id: string; name: string; startTimeMinutes: number; endTimeMinutes: number } | null }[];
}

export interface CalendarCoverage {
  month: string;
  policyVersion: string;
  leaveIntegration: 'AVAILABLE' | 'NOT_AVAILABLE';
  employees: number;
  fullyCoveredEmployees: number;
  employeesWithUnknownDays: number;
  employeesWithConflicts: number;
  dayCounts: Record<DayClassification, number>;
  sample: { employeeId: string; employeeCode: string; name: string; unknownDays: number; conflictDays: number; conflicts: string[] }[];
  sampleTruncated: boolean;
}

export interface ShiftOption {
  id: string;
  name: string;
  code: string | null;
  startTimeMinutes: number;
  endTimeMinutes: number;
  isOvernight: boolean;
  isActive: boolean;
}

const post = <T>(path: string, body: unknown) => authorizedRequest<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) => authorizedRequest<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const id = (value: string) => encodeURIComponent(value);

export const listWorkCalendars = (signal?: AbortSignal) => authorizedRequest<WorkCalendar[]>('/work-calendars', { signal: signal ?? null });
export const createWorkCalendar = (body: { code: string; name: string; description?: string | undefined; workingWeekdays: number[] }) =>
  post<WorkCalendar>('/work-calendars', body);
export const updateWorkCalendar = (calendarId: string, body: { name?: string; description?: string; workingWeekdays?: number[] }) =>
  patch<WorkCalendar>(`/work-calendars/${id(calendarId)}`, body);
export const activateWorkCalendar = (calendarId: string, approvalReference: string) =>
  post<WorkCalendar>(`/work-calendars/${id(calendarId)}/activate`, { approvalReference });
export const previewWorkCalendar = (calendarId: string, month: string, signal?: AbortSignal) =>
  authorizedRequest<CalendarPreview>(`/work-calendars/${id(calendarId)}/preview${buildQueryString({ month })}`, { signal: signal ?? null });

export const listCalendarAssignments = (params: { calendarId?: string; employeeId?: string; shiftId?: string; view?: 'current' | 'all'; page?: number; limit?: number }, signal?: AbortSignal) =>
  authorizedRequest<PaginatedResult<CalendarAssignment>>(`/work-calendars/assignments${buildQueryString(params)}`, { signal: signal ?? null });
export const createCalendarAssignment = (body: {
  calendarId: string;
  scope: CalendarAssignmentScope;
  employeeId?: string | undefined;
  workLocationId?: string | undefined;
  shiftId?: string | undefined;
  effectiveFrom: string;
  effectiveTo?: string | undefined;
  reason?: string | undefined;
}) => post<{ created: number }>('/work-calendars/assignments', body);
export const endCalendarAssignment = (assignmentId: string, effectiveTo: string, reason: string) =>
  post<CalendarAssignment>(`/work-calendars/assignments/${id(assignmentId)}/end`, { effectiveTo, reason });

export const listDayOverrides = (params: { calendarId?: string; employeeId?: string; status?: CalendarPolicyStatus }, signal?: AbortSignal) =>
  authorizedRequest<DayOverride[]>(`/work-calendars/overrides${buildQueryString(params)}`, { signal: signal ?? null });
export const createDayOverride = (body: { calendarId?: string | undefined; employeeId?: string | undefined; date: string; dayType: CalendarDayType; reason: string }) =>
  post<DayOverride>('/work-calendars/overrides', body);
export const activateDayOverride = (overrideId: string, approvalReference: string) =>
  post<DayOverride>(`/work-calendars/overrides/${id(overrideId)}/activate`, { approvalReference });
export const deactivateDayOverride = (overrideId: string, reason: string) =>
  post<DayOverride>(`/work-calendars/overrides/${id(overrideId)}/deactivate`, { reason });

export const listPublicHolidays = (params: { year?: number; status?: CalendarPolicyStatus }, signal?: AbortSignal) =>
  authorizedRequest<PublicHoliday[]>(`/public-holidays${buildQueryString(params)}`, { signal: signal ?? null });
export const createPublicHoliday = (body: { name: string; startDate: string; endDate: string; source?: string | undefined; notes?: string | undefined }) =>
  post<PublicHoliday>('/public-holidays', body);
export const updatePublicHoliday = (holidayId: string, body: { name?: string; startDate?: string; endDate?: string; source?: string; notes?: string }) =>
  patch<PublicHoliday>(`/public-holidays/${id(holidayId)}`, body);
export const activatePublicHoliday = (holidayId: string, approvalReference: string) =>
  post<PublicHoliday>(`/public-holidays/${id(holidayId)}/activate`, { approvalReference });
export const deactivatePublicHoliday = (holidayId: string, reason: string) =>
  post<PublicHoliday>(`/public-holidays/${id(holidayId)}/deactivate`, { reason });

export const getCalendarCoverage = (month: string, signal?: AbortSignal) =>
  authorizedRequest<CalendarCoverage>(`/work-calendars/coverage${buildQueryString({ month })}`, { signal: signal ?? null });
export const getEmployeeCalendarPreview = (employeeId: string, month: string, signal?: AbortSignal) =>
  authorizedRequest<EmployeeCalendarPreview>(`/work-calendars/employees/${id(employeeId)}/preview${buildQueryString({ month })}`, { signal: signal ?? null });
export const listShiftOptions = (signal?: AbortSignal) => authorizedRequest<ShiftOption[]>('/work-calendars/shift-options', { signal: signal ?? null });
