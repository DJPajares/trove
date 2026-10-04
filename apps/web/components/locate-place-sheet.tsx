'use client';

import { CircleAlert, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { fetchPlaceLocationCandidates, type PlaceLocationCandidate } from '@/lib/saved/api';
import { linkTripPlaceToProvider } from '@/lib/trip-places/api';
import * as Icons from '@/lib/icons';

type LocatePlaceSheetProps = {
  onLocated: () => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  /** The trip's Custom Place being repaired, and the name to search on first. */
  place: { name: string; placeId: string; tripId: string; tripPlaceId: string } | null;
};

type SearchState = 'empty' | 'idle' | 'results' | 'searching' | 'unavailable';

/**
 * Gives a Custom Place the coordinates it never resolved.
 *
 * Every lookup here is a provider request, so unlike place search this one does
 * not fire while typing: the field is prefilled with the name the place already
 * has and searched on an explicit submit. The server answers the same wording
 * from memory for a few minutes, so retrying a disappointing search is free.
 *
 * Every candidate is offered rather than the single best one. Ambiguity is
 * precisely why these places arrived unlocated - the planner's grounding demands
 * exactly one match and gives up otherwise - and a traveller who knows which
 * Hanoi they meant can settle it where the pipeline could not.
 *
 * Choosing a match links this trip's stop to that Google Place, so it gains the
 * address, photos, rating and hours a located-by-hand place never has. Only this
 * trip moves: Saved Places and other trips keep the Custom Place (PRD 12).
 */
export function LocatePlaceSheet({
  onLocated,
  onOpenChange,
  place,
}: Readonly<LocatePlaceSheetProps>) {
  const t = useTranslations('placeDetail');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>('idle');
  const [candidates, setCandidates] = useState<PlaceLocationCandidate[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!place) return;
    setQuery(place.name);
    setState('idle');
    setCandidates([]);
    setSavingId(null);
    setFailed(false);
  }, [place]);

  async function search() {
    if (!place) return;
    const trimmed = query.trim();
    if (!trimmed) return;

    setState('searching');
    setFailed(false);
    setCandidates([]);
    try {
      const result = await fetchPlaceLocationCandidates(place.placeId, trimmed);
      setCandidates(result.candidates);
      setState(result.status === 'empty' ? 'empty' : 'results');
    } catch {
      setState('unavailable');
    }
  }

  async function choose(candidate: PlaceLocationCandidate) {
    if (!place) return;

    setSavingId(candidate.externalPlaceId);
    setFailed(false);
    try {
      await linkTripPlaceToProvider(place.tripId, place.tripPlaceId, {
        externalPlaceId: candidate.externalPlaceId,
        label: { address: candidate.address, name: candidate.name },
        languageCode: locale,
      });
      await onLocated();
      onOpenChange(false);
    } catch {
      setFailed(true);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={Boolean(place)}>
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(34rem,calc(100%-0.5rem))]"
        closeLabel={t('locate.close')}
      >
        <SheetHeader className="border-b">
          <SheetTitle>{t('locate.title')}</SheetTitle>
          <SheetDescription>{t('locate.description')}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <Field>
              <FieldLabel htmlFor="locate-place-query">{t('locate.queryLabel')}</FieldLabel>
              {/* The field and its button share a row so the search reads as one
                  action; the hint sits under both rather than shunting the
                  button below the input's baseline. */}
              <div className="flex gap-2">
                <Input
                  autoFocus
                  className="min-w-0 flex-1"
                  id="locate-place-query"
                  maxLength={200}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('locate.queryPlaceholder')}
                  value={query}
                />
                <Button
                  className="shrink-0"
                  disabled={!query.trim() || state === 'searching'}
                  type="submit"
                  variant="outline"
                >
                  <Search aria-hidden="true" data-icon="inline-start" />
                  {state === 'searching' ? t('locate.searching') : t('locate.search')}
                </Button>
              </div>
              <FieldDescription>{t('locate.queryHint')}</FieldDescription>
            </Field>
          </form>

          {failed ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{t('locate.saveError')}</AlertDescription>
            </Alert>
          ) : null}

          {state === 'searching' ? (
            <p aria-live="polite" className="text-sm text-muted-foreground" role="status">
              {t('locate.searching')}
            </p>
          ) : null}

          {state === 'unavailable' ? (
            <Alert role="alert" variant="warning">
              <Icons.Warning aria-hidden="true" />
              <AlertDescription>{t('locate.unavailable')}</AlertDescription>
            </Alert>
          ) : null}

          {state === 'empty' ? (
            <p className="text-sm leading-6 text-muted-foreground">{t('locate.noMatches')}</p>
          ) : null}

          {state === 'results' && candidates.length ? (
            <ItemGroup aria-label={t('locate.resultsHeading')} className="gap-2">
              {candidates.map((candidate) => (
                <Item className="gap-3 px-3 py-3" key={candidate.externalPlaceId} variant="outline">
                  <ItemMedia
                    className="size-10 rounded-[var(--radius-md)] bg-brand/10 text-brand"
                    variant="icon"
                  >
                    <Icons.Places aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{candidate.name}</ItemTitle>
                    <ItemDescription>
                      {candidate.address ?? t('unavailableDescription')}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="shrink-0">
                    <Button
                      disabled={savingId !== null}
                      onClick={() => void choose(candidate)}
                      size="sm"
                      variant="outline"
                    >
                      {savingId === candidate.externalPlaceId
                        ? t('locate.saving')
                        : t('locate.use')}
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
