'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

const TENSES = [
  { icon: Icons.Itinerary, key: 'plan' },
  { icon: Icons.TripMode, key: 'live' },
  { icon: Icons.Memories, key: 'remember' },
] as const;

/**
 * Where Home's cover sits on the page: across the whole viewport at every
 * size, cancelling the page's own gutter and top padding. On a phone it runs
 * under the status area and the floating controls; from `md` it runs under the
 * header, which turns to the photograph's ink while the cover is behind it.
 *
 * Shared with the skeleton, so the cover does not move when the trips arrive.
 */
export const HOME_COVER_FRAME =
  'mx-[calc(50%-50vw)] -mt-[calc(var(--safe-top)+2rem)] min-h-[clamp(25rem,60svh,34rem)] md:-mt-[calc(var(--safe-top)+var(--header-height)+3rem)] md:min-h-[34rem] lg:min-h-[38rem]';

/**
 * Everything beneath the cover: a sheet in the page's own colour, as wide as
 * the cover, whose rounded top edge overlaps the photograph. Its padding puts
 * the content back on the page's own measure.
 */
export const HOME_SHEET =
  'relative z-10 mx-[calc(50%-50vw)] -mt-7 space-y-10 rounded-t-[1.75rem] bg-background px-[calc(50vw-50%)] pt-6 motion-safe:animate-in motion-safe:duration-700 motion-safe:ease-[var(--ease-standard)] motion-safe:slide-in-from-bottom-6 sm:space-y-12 md:-mt-10 md:rounded-t-[2.5rem] md:pt-10';

/**
 * The page's heading, in Home's own voice and set on the cover: a quiet line
 * that sets the moment, then the subject in full - "12 days until / Kyoto in
 * November", "Day 3 of / Singapore Art and Eats". It is the one line on Home
 * that changes with where the traveller is.
 *
 * With a trip to open, the subject is the link to it, stretched over the whole
 * cover so the photograph opens the trip while the heading stays a heading.
 */
export function HomeHeadline({
  href,
  lead,
  subject,
}: Readonly<{ href?: string; lead: string; subject: string }>) {
  return (
    <h1
      className="max-w-[18ch] text-[clamp(2.375rem,9.5vw,4.75rem)] leading-[1] font-semibold tracking-[-0.045em] text-balance text-white [overflow-wrap:anywhere] motion-safe:delay-100 motion-safe:animate-in motion-safe:fill-mode-both motion-safe:duration-700 motion-safe:ease-[var(--ease-standard)] motion-safe:fade-in motion-safe:slide-in-from-bottom-4"
      id="home-heading"
    >
      <span className="block text-white/75">{lead}</span>
      {href ? (
        <Link
          className="block rounded-[var(--radius-sm)] outline-none after:absolute after:inset-0 focus-visible:ring-3 focus-visible:ring-white/70"
          href={href}
        >
          {subject}
        </Link>
      ) : (
        <span className="block">{subject}</span>
      )}
    </h1>
  );
}

/**
 * Home for a traveller with no trips yet: one way forward beneath the cover's
 * open road, with the three tenses Trove is built around laid out under it so
 * the first trip has somewhere to go.
 */
export function HomeEmpty({ onCreateTrip }: Readonly<{ onCreateTrip: () => void }>) {
  const t = useTranslations('home.empty');
  const tensesT = useTranslations('home.empty.tenses');

  return (
    <div className="space-y-6" data-slot="home-empty">
      <div className="flex flex-col items-start gap-4">
        <p className="max-w-md text-base leading-[1.6] text-pretty text-muted-foreground">
          {t('description')}
        </p>
        <Button onClick={onCreateTrip}>
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t('action')}
        </Button>
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
 * Home while trips are on the way, in Home's own shape: the cover at its real
 * size and place, then the actions and the panel beneath it, so nothing moves
 * when the answer arrives (PRD 4.4).
 */
export function HomeSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">{label}</span>
      <Skeleton aria-hidden="true" className={cn('rounded-none', HOME_COVER_FRAME)} />
      <div aria-hidden="true" className={HOME_SHEET}>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-36 rounded-full" />
          <Skeleton className="h-10 w-28 rounded-full" />
        </div>
        <Skeleton className="min-h-72 rounded-[var(--radius-2xl)]" />
      </div>
    </div>
  );
}
