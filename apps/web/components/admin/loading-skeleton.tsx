interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  return (
    <div className="animate-pulse divide-y divide-border rounded-lg border border-border">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 px-4 py-3">
          {Array.from({ length: columns }).map((__, colIndex) => (
            <div key={colIndex} className="h-4 flex-1 rounded bg-surface-muted" />
          ))}
        </div>
      ))}
    </div>
  );
}
