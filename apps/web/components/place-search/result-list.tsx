'use client';

import type { ReactNode } from 'react';

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { cn } from '@/lib/utils';

/** One headed group of results: where Trove knows these places from comes first. */
export function ResultGroup({
  children,
  heading,
}: Readonly<{ children: ReactNode; heading: string }>) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium">{heading}</h2>
      <ItemGroup aria-label={heading} className="gap-2">
        {children}
      </ItemGroup>
    </div>
  );
}

/** A place in a result list: what it is, where, and what can be done with it. */
export function PlaceRow({
  children,
  description,
  hint = null,
  icon,
  naming = null,
  provider = false,
  title,
}: Readonly<{
  children: ReactNode;
  description: string | null;
  hint?: string | null;
  icon: ReactNode;
  naming?: ReactNode;
  /** Google's answer rather than Trove's own, tinted so the two never blur. */
  provider?: boolean;
  title: string;
}>) {
  return (
    <Item className="gap-3 px-3 py-3" variant="outline">
      <ItemMedia
        className={cn(
          'size-10 rounded-[var(--radius-md)]',
          provider ? 'bg-brand/10 text-brand' : 'bg-secondary text-secondary-foreground',
        )}
        variant="icon"
      >
        {icon}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="min-w-0 truncate">{title}</ItemTitle>
        {description ? <ItemDescription>{description}</ItemDescription> : null}
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        {naming}
      </ItemContent>
      <ItemActions className="shrink-0">{children}</ItemActions>
    </Item>
  );
}
