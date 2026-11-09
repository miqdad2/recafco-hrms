'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { AccessDenied } from '@/components/admin/access-denied';
import { DataTable } from '@/components/admin/data-table';
import { ErrorAlert } from '@/components/admin/error-alert';
import { FormField } from '@/components/admin/form-field';
import { FormModal } from '@/components/admin/form-modal';
import { ReasonDialog } from '@/components/admin/reason-dialog';
import { Spinner } from '@/components/admin/spinner';
import { SuccessBanner } from '@/components/admin/success-banner';
import { Notice } from '@/components/payroll/payroll-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApprovalDialog, PolicyStatusBadge } from '@/components/work-calendars/calendar-ui';
import {
  activatePublicHoliday,
  createPublicHoliday,
  deactivatePublicHoliday,
  listPublicHolidays,
  updatePublicHoliday,
  type PublicHoliday,
} from '@/lib/api/work-calendars';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';
import { currentKuwaitMonth, formatWorkDate } from '@/lib/payroll-attendance/display';
import { describeApiError } from '@/lib/payroll-attendance/errors';

const days = (h: PublicHoliday) => Math.round((Date.parse(h.endDate.slice(0, 10)) - Date.parse(h.startDate.slice(0, 10))) / 86_400_000) + 1;

export default function PublicHolidaysPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canRead = hasPermission(user, 'workCalendars.read');
  const canManage = hasPermission(user, 'workCalendars.manage');
  const canActivate = hasPermission(user, 'workCalendars.activate');
  const [year, setYear] = React.useState(Number(currentKuwaitMonth().slice(0, 4)));
  const [success, setSuccess] = React.useState<string | null>(null);
  const [editor, setEditor] = React.useState<{ holiday?: PublicHoliday } | null>(null);
  const [form, setForm] = React.useState({ name: '', startDate: '', endDate: '', source: '', notes: '' });
  const [approving, setApproving] = React.useState<PublicHoliday | null>(null);
  const [deactivating, setDeactivating] = React.useState<PublicHoliday | null>(null);

  const query = useQuery({ queryKey: ['public-holidays', year], queryFn: ({ signal }) => listPublicHolidays({ year }, signal), enabled: canRead });
  const done = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: ['public-holidays'] });
    void queryClient.invalidateQueries({ queryKey: ['work-calendars'] });
    setSuccess(message);
  };
  const save = useMutation({
    mutationFn: () =>
      editor?.holiday
        ? updatePublicHoliday(editor.holiday.id, { name: form.name, startDate: form.startDate, endDate: form.endDate, source: form.source, notes: form.notes })
        : createPublicHoliday({ name: form.name, startDate: form.startDate, endDate: form.endDate || form.startDate, source: form.source || undefined, notes: form.notes || undefined }),
    onSuccess: (h) => {
      setEditor(null);
      done(`“${h.name}” saved as a draft. It has no effect until approved.`);
    },
  });
  const approve = useMutation({
    mutationFn: (ref: string) => activatePublicHoliday((approving as PublicHoliday).id, ref),
    onSuccess: (h) => {
      setApproving(null);
      done(`“${h.name}” approved. Attendance now treats these dates as a public holiday.`);
    },
  });
  const deactivate = useMutation({
    mutationFn: (reason: string) => deactivatePublicHoliday((deactivating as PublicHoliday).id, reason),
    onSuccess: (h) => {
      setDeactivating(null);
      done(`“${h.name}” deactivated.`);
    },
  });

  if (!canRead) return <AccessDenied />;
  const err = (e: unknown, f: string) => describeApiError(e, f);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Public Holidays</h1>
          <p className="text-base text-muted-foreground">Company-wide public holidays. Entered by HR from an official source; nothing is generated automatically.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-muted-foreground">Year</span>
            <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-32">
              {Array.from({ length: 7 }, (_, i) => year - 3 + i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </label>
          {canManage ? (
            <Button
              size="lg"
              onClick={() => {
                save.reset();
                setForm({ name: '', startDate: '', endDate: '', source: '', notes: '' });
                setEditor({});
              }}
            >
              <CalendarPlus className="h-4 w-4" /> Add holiday
            </Button>
          ) : null}
        </div>
      </div>

      <Notice tone="info" title="Holidays need an official source and approval">
        A holiday is a <strong>Draft</strong> until it is approved with an HR approval reference, and it can only be approved once its official source
        (circular or decree) is recorded. Holidays cannot be added or removed inside a locked payroll period. Pay rules for working on a holiday are not
        decided yet, so such days are flagged for review.
      </Notice>

      {success ? <SuccessBanner message={success} onDismiss={() => setSuccess(null)} /> : null}
      {query.isError ? <ErrorAlert message={err(query.error, 'Could not load holidays.') ?? ''} /> : null}

      <DataTable
        columns={[
          { key: 'name', header: 'Holiday', render: (h: PublicHoliday) => <span className="font-medium">{h.name}</span> },
          {
            key: 'dates',
            header: 'Dates',
            render: (h: PublicHoliday) => (
              <span className="flex flex-col">
                <span>{h.startDate.slice(0, 10) === h.endDate.slice(0, 10) ? formatWorkDate(h.startDate) : `${formatWorkDate(h.startDate)} – ${formatWorkDate(h.endDate)}`}</span>
                <span className="text-xs text-muted-foreground">{days(h)} day(s)</span>
              </span>
            ),
          },
          { key: 'status', header: 'Status', render: (h: PublicHoliday) => <PolicyStatusBadge status={h.status} /> },
          {
            key: 'source',
            header: 'Source / approval',
            render: (h: PublicHoliday) => (
              <span className="flex max-w-[18rem] flex-col text-sm">
                <span>{h.source ?? <span className="text-warning">No source recorded</span>}</span>
                {h.approvalReference ? <span className="text-xs text-muted-foreground">Approval: {h.approvalReference}</span> : null}
                {h.deactivationReason ? <span className="text-xs text-muted-foreground">Deactivated: {h.deactivationReason}</span> : null}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            className: 'text-right',
            render: (h: PublicHoliday) => (
              <div className="flex flex-wrap justify-end gap-2">
                {canManage && h.status === 'DRAFT' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      save.reset();
                      setForm({ name: h.name, startDate: h.startDate.slice(0, 10), endDate: h.endDate.slice(0, 10), source: h.source ?? '', notes: h.notes ?? '' });
                      setEditor({ holiday: h });
                    }}
                  >
                    Edit
                  </Button>
                ) : null}
                {canActivate && h.status === 'DRAFT' ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      approve.reset();
                      setApproving(h);
                    }}
                  >
                    Approve
                  </Button>
                ) : null}
                {canActivate && h.status !== 'INACTIVE' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      deactivate.reset();
                      setDeactivating(h);
                    }}
                  >
                    Deactivate
                  </Button>
                ) : null}
              </div>
            ),
          },
        ]}
        data={query.data ?? []}
        getRowId={(h) => h.id}
        isLoading={query.isLoading}
        emptyMessage={`No holidays recorded for ${year}.`}
      />

      <FormModal open={editor !== null} title={editor?.holiday ? 'Edit draft holiday' : 'Add public holiday (draft)'} onClose={() => setEditor(null)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <FormField label="Holiday name" htmlFor="h-name" required>
            <Input id="h-name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="First day" htmlFor="h-start" required>
              <Input id="h-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </FormField>
            <FormField label="Last day (blank = same day)" htmlFor="h-end">
              <Input id="h-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Official source (needed before approval)" htmlFor="h-source">
            <Input id="h-source" value={form.source} maxLength={300} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. Civil Service Bureau circular no. …" />
          </FormField>
          <FormField label="Notes (optional)" htmlFor="h-notes">
            <Textarea id="h-notes" rows={2} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </FormField>
          {save.isError ? <ErrorAlert message={err(save.error, 'Could not save the holiday.') ?? ''} /> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={save.isPending || !form.name.trim() || !form.startDate}>
              {save.isPending ? <Spinner /> : null} Save draft
            </Button>
          </div>
        </form>
      </FormModal>

      <ApprovalDialog
        key={approving?.id ?? 'closed'}
        open={approving !== null}
        title={`Approve “${approving?.name ?? ''}”`}
        description={`From ${approving ? formatWorkDate(approving.startDate) : ''} to ${approving ? formatWorkDate(approving.endDate) : ''}. Source: ${approving?.source ?? 'none recorded'}.`}
        isLoading={approve.isPending}
        error={approve.isError ? err(approve.error, 'Could not approve the holiday.') : null}
        onConfirm={(ref) => approve.mutate(ref)}
        onCancel={() => setApproving(null)}
      />
      <ReasonDialog
        key={deactivating?.id ?? 'closed-deactivate'}
        open={deactivating !== null}
        title={`Deactivate “${deactivating?.name ?? ''}”?`}
        description="These dates return to each employee's normal calendar. History is kept. Not allowed inside a locked payroll period."
        confirmLabel="Deactivate"
        isLoading={deactivate.isPending}
        error={deactivate.isError ? (err(deactivate.error, 'Could not deactivate.') ?? undefined) : undefined}
        onConfirm={(reason) => deactivate.mutate(reason)}
        onCancel={() => setDeactivating(null)}
      />
    </div>
  );
}
