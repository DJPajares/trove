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
  enterKeyHint = 'search',
  id,
  label,
  onKeyDown,
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
        className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        // Search is a pill, like every action (see Button); form fields stay rounded rectangles.
        className={cn('rounded-full pr-4 pl-10.5', className)}
        enterKeyHint={enterKeyHint}
        id={inputId}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        type="search"
        {...props}
      />
    </div>
  );
}
