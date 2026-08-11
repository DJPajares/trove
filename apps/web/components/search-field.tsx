'use client';

import { Search } from 'lucide-react';
import { useId } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type SearchFieldProps = Omit<React.ComponentProps<typeof Input>, 'type'> & {
  label: string;
  wrapperClassName?: string;
};

export function SearchField({
  className,
  id,
  label,
  wrapperClassName,
  ...props
}: Readonly<SearchFieldProps>) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={cn('relative w-full', wrapperClassName)} data-slot="search-field">
      <Label className="sr-only" htmlFor={inputId}>
        {label}
      </Label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input className={cn('pr-4 pl-10', className)} id={inputId} type="search" {...props} />
    </div>
  );
}
