'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  // Local state is seeded once from `value` and then owned by this component — nothing in this
  // app resets `value` from outside except via this component's own onChange, so no prop-sync is needed.
  const [localValue, setLocalValue] = React.useState(value);
  const onChangeRef = React.useRef(onChange);

  React.useEffect(() => {
    onChangeRef.current = onChange;
  });

  React.useEffect(() => {
    const handle = setTimeout(() => {
      onChangeRef.current(localValue);
    }, 350);
    return () => clearTimeout(handle);
  }, [localValue]);

  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle-foreground" />
      <Input
        value={localValue}
        onChange={(event) => setLocalValue(event.target.value)}
        placeholder={placeholder ?? 'Search…'}
        className="pl-9"
      />
    </div>
  );
}
