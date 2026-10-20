'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  ON_DEMAND_SEARCH_MINIMUM,
  type useOnDemandPlaceSearch,
} from '@/hooks/use-on-demand-place-search';
import { cn } from '@/lib/utils';

/**
 * The one way a place picker reaches Google: after Trove has answered from what
 * it already knows, and only when the traveller asks. Every picker shows the
 * same step in the same words, so it reads as "look further", not as a mode.
 *
 * With Trove's own matches above it the step stays a quiet line; with none it
 * becomes the obvious next thing to do. Once asked, it says what Google said.
 */
export function GoogleSearchRow({
  className,
  online,
  prominent = false,
  query,
  search,
}: Readonly<{
  className?: string;
  online: boolean;
  /** Nothing in Trove matched, so searching further is the next step. */
  prominent?: boolean;
  query: string;
  search: ReturnType<typeof useOnDemandPlaceSearch>;
}>) {
  const t = useTranslations('placeSearch');
  const typed = query.trim();
  if (!typed) return null;

  const note = (text: string, status = false) => (
    <p
      className={cn('px-1 text-xs text-muted-foreground', className)}
      role={status ? 'status' : undefined}
    >
      {text}
    </p>
  );

  if (search.results.length) {
    return (
      <p className={cn('px-1 text-right text-xs text-muted-foreground', className)}>
        <span translate="no">{t('attribution')}</span>
      </p>
    );
  }
  if (search.status === 'loading') return note(t('searching'), true);
  if (search.status === 'unavailable') return note(t('unavailable'), true);
  if (search.asked(typed)) return note(t('empty', { query: typed }), true);
  if (!online) return note(t('offline'));
  if (typed.length < ON_DEMAND_SEARCH_MINIMUM) return note(t('minimum'));

  return (
    <div className={cn('space-y-2', className)}>
      {prominent ? <p className="px-1 text-sm text-muted-foreground">{t('notInTrove')}</p> : null}
      <Button
        className={cn('w-full', prominent ? 'justify-center' : 'justify-start')}
        onClick={() => void search.search(typed)}
        size={prominent ? 'default' : 'sm'}
        type="button"
        variant={prominent ? 'outline' : 'ghost'}
      >
        <Search aria-hidden="true" data-icon="inline-start" />
        <span className="min-w-0 truncate">{t('searchGoogle', { query: typed })}</span>
      </Button>
    </div>
  );
}
