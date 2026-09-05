'use client';

import { CircleAlert, MapPinned, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  fetchPlaceLocationCandidates,
  type PlaceLocationCandidate,
  updateCustomPlace,
} from '@/lib/saved/api';

type LocatePlaceDialogProps = {
  onLocated: () => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  /** The Custom Place being repaired: its id, and the name to search on first. */
  place: { id: string; name: string } | null;
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
 * The coordinates land on the Place itself, which Saved Places and Trip Places
 * both point at, so neither relationship moves and one repair reaches every trip
 * using it.
 */
export function LocatePlaceDialog({
  onLocated,
  onOpenChange,
  place,
}: Readonly<LocatePlaceDialogProps>) {
  const t = useTranslations('placeDetail');
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
      const result = await fetchPlaceLocationCandidates(place.id, trimmed);
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
      // The time zone is deliberately absent. A candidate carries a UTC offset,
      // not an IANA zone, and the itinerary does DST-correct maths with that
      // field - so an omitted zone leaves whatever the place already had.
      await updateCustomPlace(place.id, {
        location: { latitude: candidate.latitude, longitude: candidate.longitude },
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
    <Dialog onOpenChange={onOpenChange} open={Boolean(place)}>
      <DialogContent closeLabel={t('locate.close')}>
        <DialogHeader>
          <DialogTitle>{t('locate.title')}</DialogTitle>
          <DialogDescription>{t('locate.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
              <CircleAlert aria-hidden="true" />
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
                    <MapPinned aria-hidden="true" />
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
      </DialogContent>
    </Dialog>
  );
}
