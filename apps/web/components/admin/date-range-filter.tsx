import { Input } from '@/components/ui/input';

interface DateRangeFilterProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}

export function DateRangeFilter({ from, to, onFromChange, onToChange }: DateRangeFilterProps) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        value={from}
        onChange={(event) => onFromChange(event.target.value)}
        className="w-40"
        aria-label="From date"
      />
      <span className="text-sm text-muted-foreground">to</span>
      <Input
        type="date"
        value={to}
        onChange={(event) => onToChange(event.target.value)}
        className="w-40"
        aria-label="To date"
      />
    </div>
  );
}
