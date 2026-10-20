'use client';

import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

/** Rows that read as one list: a stop's details, each a line until opened. */
export function EditRows({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="divide-y divide-border-subtle overflow-hidden rounded-[var(--radius-lg)] border border-border-subtle bg-card">
      {children}
    </div>
  );
}

/**
 * One detail of a stop as a line - what it is, and what it is set to - that
 * opens in place to change it. Reading comes first; editing is one tap away,
 * and only for the detail being changed.
 */
export function EditRow({
  children,
  defaultOpen = false,
  emptyValue = '—',
  icon,
  label,
  value,
}: Readonly<{
  children: ReactNode;
  defaultOpen?: boolean;
  /** What an unset detail reads as, when it falls back to something rather than nothing. */
  emptyValue?: string;
  icon: ReactNode;
  label: string;
  /** What the detail is set to, or nothing when it is not set. */
  value: string | null;
}>) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex min-h-12 w-full items-center gap-3 rounded-none px-4 py-2.5 text-left text-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-inset">
        <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
        <span className="shrink-0 text-sm font-medium">{label}</span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-right text-sm font-normal',
            value ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {value ?? emptyValue}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground transition-transform duration-[var(--motion-standard)] group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="space-y-3 px-4 pt-1 pb-4">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/**
 * A single choice among a few, as one segmented bar: the planner's view switch,
 * as a control. Choosing the chosen option again leaves it chosen.
 */
export function Segmented<Value extends string>({
  label,
  onChange,
  options,
  value,
}: Readonly<{
  label: string;
  onChange: (value: Value) => void;
  options: readonly { label: string; value: Value }[];
  value: Value | null;
}>) {
  return (
    <ToggleGroupPrimitive<Value>
      aria-label={label}
      className="flex h-9 w-full items-center gap-1 rounded-[var(--radius-md)] bg-muted/30 p-1"
      multiple={false}
      onValueChange={([next]) => {
        if (next) onChange(next);
      }}
      value={value ? [value] : []}
    >
      {options.map((option) => (
        <TogglePrimitive<Value>
          className="h-7 min-w-0 flex-1 truncate rounded-[var(--radius-sm)] px-2 text-[0.8125rem] font-medium text-muted-foreground outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 data-[pressed]:bg-secondary data-[pressed]:text-foreground data-[pressed]:shadow-[var(--shadow-control)] motion-reduce:transition-none"
          key={option.value}
          value={option.value}
        >
          {option.label}
        </TogglePrimitive>
      ))}
    </ToggleGroupPrimitive>
  );
}
