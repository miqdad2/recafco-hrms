import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { EmptyState } from './empty-state';
import { TableSkeleton } from './loading-skeleton';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowId: (row: T) => string;
  isLoading?: boolean;
  emptyMessage?: string;
}

export function DataTable<T>({ columns, data, getRowId, isLoading, emptyMessage }: DataTableProps<T>) {
  if (isLoading) {
    return <TableSkeleton columns={columns.length} />;
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border">
        <EmptyState message={emptyMessage ?? 'No records found.'} />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={cn('px-4 py-3', column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((row) => (
            <tr key={getRowId(row)} className="hover:bg-surface-muted/50">
              {columns.map((column) => (
                <td key={column.key} className={cn('px-4 py-3 align-middle text-foreground', column.className)}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
