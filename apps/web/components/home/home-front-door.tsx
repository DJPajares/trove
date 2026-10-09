'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { MediaFrame } from '@/components/media-frame';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import * as Icons from '@/lib/icons';

const TENSES = [
  { icon: Icons.Itinerary, key: 'plan' },
  { icon: Icons.TripMode, key: 'live' },
  { icon: Icons.Memories, key: 'remember' },
] as const;

/**
 * The page's heading, in Home's own voice: a quiet line that sets the moment,
 * then the subject in full ink - "12 days until / Kyoto in November", "Day 3
 * of / Singapore Art and Eats". It is the one line on Home that changes with
 * where the traveller is, so it is the line that makes Home feel alive.
 */
export function HomeHeadline({ lead, subject }: Readonly<{ lead: string; subject: string }>) {
  return (
    <h1
      className="max-w-[18ch] text-[clamp(2.375rem,9.5vw,4.25rem)] leading-[1] font-semibold tracking-[-0.045em] text-balance [overflow-wrap:anywhere]"
      id="home-heading"
    >
      <span className="block text-text-subtle">{lead}</span>
      <span className="block text-foreground">{subject}</span>
    </h1>
  );
}

/**
 * Home for a traveller with no trips yet: an open road and one way forward,
 * with the three tenses Trove is built around laid out beneath it so the
 * first trip has somewhere to go.
 *
 * The photograph is Trove's own bundled artwork, not an editorial lookup:
 * with no trip there is no subject to ask a photograph of, and nothing here
 * should cost a request before the traveller has made anything.
 */
export function HomeEmpty({ onCreateTrip }: Readonly<{ onCreateTrip: () => void }>) {
  const t = useTranslations('home.empty');
  const tensesT = useTranslations('home.empty.tenses');

  return (
    <div className="space-y-6" data-slot="home-empty">
      <div className="relative isolate overflow-hidden rounded-[var(--radius-2xl)] bg-surface-media text-white shadow-[var(--shadow-elevated)]">
        <MediaFrame
          alt=""
          className="aspect-[4/5] w-full rounded-none sm:aspect-[16/9]"
          dataSlot="home-empty-media"
          photographicPlaceholder={dayHeaderFallback.preview}
          preload
          sizes="(max-width: 1023px) 100vw, 1024px"
          source={{ kind: 'local', src: dayHeaderFallback.src }}
          variant="card"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(180deg,transparent_30%,rgba(8,18,13,0.55)_58%,rgba(8,18,13,0.9)_100%)]"
        />
        <div className="absolute inset-x-0 bottom-0 space-y-4 p-5 sm:p-8">
          <p className="max-w-md text-base leading-[1.55] text-pretty text-white/90">
            {t('description')}
          </p>
          <Button onClick={onCreateTrip}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('action')}
          </Button>
        </div>
      </div>

      <ol className="grid gap-px overflow-hidden rounded-[var(--radius-2xl)] border border-border-subtle bg-border-subtle sm:grid-cols-3">
        {TENSES.map(({ icon: Icon, key }) => (
          <li className="flex gap-3 bg-card p-5" key={key}>
            <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{tensesT(`${key}.title`)}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {tensesT(`${key}.description`)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Every trip finished and none planned: the one thing Home has to offer is
 * the next trip, and it offers it in a line rather than a second heading.
 */
export function HomeIdle({ onCreateTrip }: Readonly<{ onCreateTrip: () => void }>) {
  const t = useTranslations('home.idle');

  return (
    <div className="flex flex-col items-start gap-4" data-slot="home-idle">
      <p className="max-w-md text-base leading-[1.6] text-muted-foreground">{t('description')}</p>
      <Button onClick={onCreateTrip}>
        <Plus aria-hidden="true" data-icon="inline-start" />
        {t('action')}
      </Button>
    </div>
  );
}

/**
 * Home while trips are on the way, in Home's own shape: the headline's two
 * lines, the photograph and the panel beside it at their real sizes, so
 * nothing moves when the answer arrives (PRD 4.4). The weather strip above is
 * already its own and waits on its own.
 */
export function HomeSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-8" role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-[clamp(2.375rem,9.5vw,4.25rem)] w-2/5 max-w-xs" />
        <Skeleton className="h-[clamp(2.375rem,9.5vw,4.25rem)] w-4/5 max-w-lg" />
      </div>
      <div
        aria-hidden="true"
        className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-8"
      >
        <div className="space-y-5">
          <Skeleton className="aspect-[5/4] w-full rounded-[var(--radius-2xl)] sm:aspect-[16/9] lg:aspect-[4/3]" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-36 rounded-full" />
            <Skeleton className="h-10 w-28 rounded-full" />
          </div>
        </div>
        <Skeleton className="min-h-72 rounded-[var(--radius-2xl)]" />
      </div>
    </div>
  );
}
