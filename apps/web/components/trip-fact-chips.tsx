import { CalendarDays, Route, Users } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { usePreferences } from '@/components/preferences-provider';
import { formatDistanceValue } from '@/lib/itinerary/format-distance';
import type { Trip } from '@/lib/trips/api';
import { tripFacts, type TripFact } from '@/lib/trips/facts';
import { cn } from '@/lib/utils';

const chipVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[length:var(--text-metadata)] leading-5 font-medium whitespace-nowrap tabular-nums [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        // The scrim below is dark in both themes, so this pair does not flip -
        // the same reasoning the badges' own onMedia tone follows.
        onMedia: 'border border-white/22 bg-white/14 text-white backdrop-blur-sm',
        surface: 'border border-border-subtle bg-surface-raised text-muted-foreground',
      },
    },
    defaultVariants: { tone: 'surface' },
  },
);

export type TripFactChipsProps = {
  className?: string;
  /**
   * How the facts are set out.
   *
   * `chips` gives each one its own pill, for a surface where they sit over a
   * photograph and need their own ground. `stats` runs them together as one
   * rule-divided strip, which is what a profile's numbers look like and what
   * stops a hero reading as a tag cloud. Same facts, same wording, either way.
   */
  layout?: 'chips' | 'stats';
  /** Rendered ahead of the derived facts, for a surface that leads with dates. */
  leading?: ReactNode;
  tone?: 'onMedia' | 'surface';
  trip: Trip;
};

/**
 * What a trip is, in four words or fewer: how long, how far, how many.
 *
 * Plain elements rather than `ui/chip`, which is a Base UI toggle built for
 * filtering. These are statements, not controls, and giving a fact the affordances
 * of a button invites a press that does nothing.
 *
 * The span reads as an approximation on purpose. It is a straight line between
 * stops rather than a route - see `tripSpanMeters` - and the only honest way to
 * show a free number beside a product that elsewhere sells real road distances
 * is to mark it as the estimate it is, with the full sentence available to a
 * screen reader.
 */
export function TripFactChips({
  className,
  layout = 'chips',
  leading,
  tone = 'surface',
  trip,
}: Readonly<TripFactChipsProps>) {
  const t = useTranslations('trips');
  const itineraryT = useTranslations('itinerary');
  const unitsT = useTranslations('itinerary.routes.units');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const facts = tripFacts(trip);

  function label(fact: TripFact) {
    if (fact.kind === 'days') return itineraryT('dayCount', { count: fact.count });
    if (fact.kind === 'travellers') return t('travellerCount', { count: fact.count });

    return t('spanDistance', {
      unit: unitsT(preferences.distanceUnit),
      value: formatDistanceValue(fact.meters, preferences.distanceUnit, locale),
    });
  }

  const icons = { days: CalendarDays, span: Route, travellers: Users } as const;
  const stats = layout === 'stats';
  const itemClassName = stats
    ? 'inline-flex items-center gap-1.5 px-3.5 text-sm font-medium whitespace-nowrap text-foreground tabular-nums first:ps-0 last:pe-0 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-subtle'
    : chipVariants({ tone });

  return (
    <ul
      className={cn(
        stats
          ? 'flex flex-wrap items-center justify-center divide-x divide-border-subtle'
          : 'flex flex-wrap items-center gap-2',
        className,
      )}
      data-slot="trip-fact-chips"
    >
      {leading ? <li className={itemClassName}>{leading}</li> : null}
      {facts.map((fact) => {
        const Icon = icons[fact.kind];

        return (
          <li className={itemClassName} key={fact.kind}>
            <Icon aria-hidden="true" />
            {fact.kind === 'span' ? (
              <>
                <span aria-hidden="true">{label(fact)}</span>
                <span className="sr-only">
                  {t('spanDistanceLabel', {
                    unit: unitsT(preferences.distanceUnit),
                    value: formatDistanceValue(fact.meters, preferences.distanceUnit, locale),
                  })}
                </span>
              </>
            ) : (
              label(fact)
            )}
          </li>
        );
      })}
    </ul>
  );
}
