'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { FormField } from '@/components/admin/form-field';
import { SearchInput } from '@/components/admin/search-input';
import { Spinner } from '@/components/admin/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge, type BadgeTone } from '@/components/ui/status-badge';
import { listEmployees } from '@/lib/api/employees';
import type { CalendarPolicyStatus, DayClassification } from '@/lib/api/work-calendars';
import { DAY_CLASSIFICATION_LABELS, WEEKDAY_LABELS } from '@/lib/payroll-attendance/display';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<CalendarPolicyStatus, string> = { DRAFT: 'Draft — not in use', ACTIVE: 'Active (approved)', INACTIVE: 'Inactive' };
const STATUS_TONES: Record<CalendarPolicyStatus, BadgeTone> = { DRAFT: 'warning', ACTIVE: 'success', INACTIVE: 'muted' };

export function PolicyStatusBadge({ status }: { status: CalendarPolicyStatus }) {
  return <StatusBadge label={STATUS_LABELS[status]} tone={STATUS_TONES[status]} className="text-sm" />;
}

/** "Sun Mon Tue …" with working days highlighted; text-labelled, not colour-only. */
export function WeekdayChips({ workingWeekdays }: { workingWeekdays: number[] }) {
  return (
    <div className="flex flex-wrap gap-1" aria-label={`Working days: ${workingWeekdays.map((d) => WEEKDAY_LABELS[d]).join(', ') || 'none'}`}>
      {WEEKDAY_LABELS.map((label, index) => {
        const working = workingWeekdays.includes(index);
        return (
          <span
            key={label}
            title={working ? `${label}: working day` : `${label}: rest day`}
            className={cn(
              'rounded-md border px-2 py-0.5 text-xs font-medium',
              working ? 'border-success/30 bg-success/10 text-success' : 'border-border bg-surface-muted text-muted-foreground line-through',
            )}
          >
            {label.slice(0, 3)}
          </span>
        );
      })}
    </div>
  );
}

const CELL_CLASSES: Record<DayClassification, string> = {
  SCHEDULED_WORKDAY: 'border-success/30 bg-success/10',
  REST_DAY: 'border-border bg-surface-muted',
  PUBLIC_HOLIDAY: 'border-info/30 bg-info/10',
  APPROVED_LEAVE: 'border-info/30 bg-info/10',
  NOT_EMPLOYED: 'border-border bg-surface-muted/40 text-muted-foreground',
  UNKNOWN: 'border-error/40 bg-error/10',
};

export interface GridDay {
  date: string;
  classification: DayClassification;
  detail?: React.ReactNode;
  flagged?: boolean;
}

/** Month calendar (Sunday-first), each cell labelled with its classification in words. */
export function CalendarMonthGrid({ days }: { days: GridDay[] }) {
  if (days.length === 0) return null;
  const first = new Date(`${days[0]?.date}T00:00:00Z`).getUTCDay();
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase text-muted-foreground">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w}>{w.slice(0, 3)}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: first }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {days.map((d) => (
          <div key={d.date} className={cn('flex min-h-20 flex-col gap-0.5 rounded-md border p-1.5 text-xs', CELL_CLASSES[d.classification], d.flagged && 'ring-2 ring-error')}>
            <span className="text-sm font-semibold text-foreground">{Number(d.date.slice(8))}</span>
            <span className="font-medium leading-tight">{DAY_CLASSIFICATION_LABELS[d.classification]}</span>
            {d.detail ? <span className="leading-tight text-muted-foreground">{d.detail}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Approval dialog for activating a policy record. The approval reference (HR decision / memo
 * number) is mandatory and stored in the audit log. Mount with a fresh `key` per target.
 */
export function ApprovalDialog({
  open,
  title,
  description,
  isLoading,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  isLoading: boolean;
  error?: string | null | undefined;
  onConfirm: (approvalReference: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  if (!open) return null;
  const trimmed = value.trim();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-4">
          <FormField label="HR approval reference (decision, memo or circular number)" htmlFor="approval-ref" required error={touched && !trimmed ? 'An approval reference is required.' : (error ?? undefined)}>
            <Input id="approval-ref" value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} />
          </FormField>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            size="lg"
            disabled={isLoading}
            onClick={() => {
              setTouched(true);
              if (trimmed) onConfirm(trimmed);
            }}
          >
            {isLoading ? (
              <>
                <Spinner /> Please wait…
              </>
            ) : (
              'Approve and activate'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Server-side employee search (directory endpoint), returns the chosen employee. */
export function EmployeePicker({
  value,
  onChange,
}: {
  value: { id: string; label: string } | null;
  onChange: (employee: { id: string; label: string } | null) => void;
}) {
  const [search, setSearch] = React.useState('');
  const query = useQuery({
    queryKey: ['employees', 'calendar-picker', search],
    queryFn: () => listEmployees({ search, limit: 8 }),
    enabled: search.trim().length >= 2 && value === null,
  });
  if (value) {
    return (
      <span className="inline-flex h-10 items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 text-sm font-medium text-foreground">
        {value.label}
        <button type="button" aria-label="Clear employee" className="text-muted-foreground hover:text-foreground" onClick={() => onChange(null)}>
          <X className="h-4 w-4" />
        </button>
      </span>
    );
  }
  return (
    <div className="relative">
      <SearchInput value={search} onChange={setSearch} placeholder="Search employee name or code…" />
      {search.trim().length >= 2 ? (
        <div className="absolute top-full z-20 mt-1 w-80 rounded-md border border-border bg-surface shadow-lg">
          {query.isLoading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Spinner /> Searching…
            </div>
          ) : (query.data?.data ?? []).length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No matching employees.</div>
          ) : (
            (query.data?.data ?? []).map((e) => (
              <button
                key={e.id}
                type="button"
                className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-surface-muted"
                onClick={() => onChange({ id: e.id, label: `${e.fullName} (${e.employeeCode})` })}
              >
                <span className="font-medium text-foreground">{e.fullName}</span>
                <span className="text-xs text-muted-foreground">
                  {e.employeeCode}
                  {e.workLocation?.name ? ` · ${e.workLocation.name}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
