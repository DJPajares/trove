'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ItineraryTripPlace } from '@/lib/itinerary/api';
import * as Icons from '@/lib/icons';

/** Must Go places offered at once; the rest are in Places. */
const MUST_GO_SHOWN = 4;

/**
 * A day with nothing on it yet - said plainly, never as a field the day is
 * waiting on (PRD 17.2.1) - with the quickest ways to start it: the trip's
 * Must Go places that are not on any day yet, each one tap from being this
 * day's first stop, then a stop of any kind, then the trip's Places.
 *
 * Adding a Must Go uses a Trip Place the trip already has, so it works offline
 * like any stop that does (PRD 28.2).
 */
export function DayEmpty({
  dayNumber,
  mustGo,
  onAddMustGo,
  onAddStop,
  onBrowsePlaces,
  placeName,
  town,
  tripIsEmpty,
}: Readonly<{
  dayNumber: number;
  /** Must Go Trip Places not yet on any day. */
  mustGo: readonly ItineraryTripPlace[];
  onAddMustGo: (tripPlace: ItineraryTripPlace) => Promise<void>;
  onAddStop: () => void;
  onBrowsePlaces: () => void;
  placeName: (tripPlace: ItineraryTripPlace) => string;
  town: string | null;
  /** Nothing is planned on any day yet: this is where the trip starts. */
  tripIsEmpty: boolean;
}>) {
  const t = useTranslations('itinerary.planner.empty');
  const [adding, setAdding] = useState<string | null>(null);

  return (
    <section
      aria-labelledby="day-empty-title"
      className="rounded-[var(--radius-xl)] border border-dashed border-border bg-surface-tint/30 p-5"
      data-slot="day-empty"
    >
      <h3 className="text-base font-semibold" id="day-empty-title">
        {tripIsEmpty
          ? t('tripTitle')
          : town
            ? t('dayTitleTown', { number: dayNumber, town })
            : t('dayTitle', { number: dayNumber })}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {tripIsEmpty ? t('tripDescription') : t('dayDescription')}
      </p>

      {mustGo.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {t('mustGoTitle')}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {mustGo.slice(0, MUST_GO_SHOWN).map((tripPlace) => (
              <li key={tripPlace.id}>
                <Button
                  disabled={adding !== null}
                  onClick={async () => {
                    setAdding(tripPlace.id);
                    try {
                      await onAddMustGo(tripPlace);
                    } finally {
                      setAdding(null);
                    }
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Icons.MustGo aria-hidden="true" data-icon="inline-start" />
                  {t('addMustGo', { name: placeName(tripPlace) })}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onAddStop} size="sm" type="button">
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t('addStop')}
        </Button>
        <Button onClick={onBrowsePlaces} size="sm" type="button" variant="ghost">
          <Icons.Places aria-hidden="true" data-icon="inline-start" />
          {t('browsePlaces')}
        </Button>
      </div>
    </section>
  );
}
