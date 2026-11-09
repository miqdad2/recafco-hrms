'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Lock, type LucideIcon } from 'lucide-react';
import type { BadgeTone } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MonthlyReviewStatus } from '@/lib/api/payroll-attendance';
import {
  EXCEPTION_INFO,
  REVIEW_STATUS_DESCRIPTIONS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_TONES,
  exceptionLabel,
  exceptionTone,
  formatMonth,
  shiftMonth,
} from '@/lib/payroll-attendance/display';
import { cn } from '@/lib/utils';

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  error: 'border-error/30 bg-error/10 text-error',
  info: 'border-info/30 bg-info/10 text-info',
  muted: 'border-border bg-surface-muted text-muted-foreground',
  locked: 'border-locked/30 bg-locked/10 text-locked',
};

const STATUS_ICONS: Record<MonthlyReviewStatus, LucideIcon> = {
  CALCULATED: CheckCircle2,
  NEEDS_REVIEW: AlertTriangle,
  INCOMPLETE: CircleAlert,
  LOCKED: Lock,
};

/** Monthly review status — icon + label + tooltip, so colour is never the only signal. */
export function ReviewStatusBadge({ status }: { status: MonthlyReviewStatus }) {
  const Icon = STATUS_ICONS[status];
  return (
    <span
      title={REVIEW_STATUS_DESCRIPTIONS[status]}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-sm font-medium',
        TONE_CLASSES[REVIEW_STATUS_TONES[status]],
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {REVIEW_STATUS_LABELS[status]}
    </span>
  );
}

/** One exception code as a readable chip; the technical code is in the tooltip (and optionally visible). */
export function ExceptionChip({ code, count, showCode }: { code: string; count?: number | undefined; showCode?: boolean | undefined }) {
  const info = EXCEPTION_INFO[code as keyof typeof EXCEPTION_INFO];
  return (
    <span
      title={`${info?.description ?? ''} [${code}]`.trim()}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
        TONE_CLASSES[exceptionTone(code)],
      )}
    >
      {exceptionLabel(code)}
      {count !== undefined ? <span className="font-semibold">× {count}</span> : null}
      {showCode ? <span className="font-mono text-[11px] opacity-75">{code}</span> : null}
    </span>
  );
}

export function ExceptionList({
  codes,
  counts,
  showCode,
  max,
}: {
  codes: string[];
  counts?: Partial<Record<string, number>> | undefined;
  showCode?: boolean | undefined;
  max?: number | undefined;
}) {
  if (codes.length === 0) {
    return <span className="text-sm text-muted-foreground">None</span>;
  }
  const visible = max !== undefined ? codes.slice(0, max) : codes;
  const hidden = codes.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((code) => (
        <ExceptionChip key={code} code={code} count={counts?.[code]} showCode={showCode} />
      ))}
      {hidden > 0 ? (
        <span className="text-xs text-muted-foreground" title={codes.slice(visible.length).map(exceptionLabel).join(', ')}>
          +{hidden} more
        </span>
      ) : null}
    </div>
  );
}

/** Summary card. `partial` adds the mandatory "Known so far" label for totals that are not complete. */
export function StatCard({
  label,
  value,
  hint,
  tone,
  partial,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode | undefined;
  tone?: BadgeTone | undefined;
  partial?: boolean | undefined;
  icon?: LucideIcon | undefined;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {Icon ? <Icon className={cn('h-4 w-4', tone ? TONE_TEXT[tone] : undefined)} aria-hidden /> : null}
          {label}
        </span>
        {partial ? (
          <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
            Known so far
          </span>
        ) : null}
      </div>
      <span className={cn('text-3xl font-semibold tabular-nums', tone ? TONE_TEXT[tone] : 'text-foreground')}>{value}</span>
      {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

const TONE_TEXT: Record<BadgeTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  info: 'text-info',
  muted: 'text-muted-foreground',
  locked: 'text-locked',
};

export function StatCardSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="h-4 w-24 rounded bg-surface-muted" />
      <div className="h-8 w-20 rounded bg-surface-muted" />
      <div className="h-3 w-32 rounded bg-surface-muted" />
    </div>
  );
}

/** Previous / month input / next. Emits "YYYY-MM". */
export function MonthPicker({ value, onChange, id = 'month-picker' }: { value: string; onChange: (month: string) => void; id?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="default" onClick={() => onChange(shiftMonth(value, -1))} aria-label="Previous month">
        <ChevronLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Previous</span>
      </Button>
      <label htmlFor={id} className="sr-only">
        Month
      </label>
      <Input
        id={id}
        type="month"
        value={value}
        min="2000-01"
        max="2099-12"
        onChange={(event) => {
          if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(event.target.value)) onChange(event.target.value);
        }}
        className="w-44 text-base"
        aria-label={`Selected month: ${formatMonth(value)}`}
      />
      <Button variant="outline" size="default" onClick={() => onChange(shiftMonth(value, 1))} aria-label="Next month">
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Prominent, non-dismissable notice for payroll-critical caveats. */
export function Notice({ tone, title, children }: { tone: BadgeTone; title: string; children?: React.ReactNode }) {
  const Icon = tone === 'error' ? CircleAlert : tone === 'locked' ? Lock : AlertTriangle;
  return (
    <div role="note" className={cn('flex items-start gap-3 rounded-xl border px-4 py-3', TONE_CLASSES[tone])}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">{title}</span>
        {children ? <div className="text-foreground/80">{children}</div> : null}
      </div>
    </div>
  );
}
