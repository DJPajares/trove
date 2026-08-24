'use client';

import {
  Bookmark,
  CircleAlert,
  ExternalLink,
  FileText,
  Info,
  MapPinned,
  Plane,
  ReceiptText,
  Search,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ContentSkeleton } from '@/components/content-skeleton';
import { PageState } from '@/components/page-state';
import { SearchField } from '@/components/search-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import {
  searchTrove,
  type SearchResponse,
  type SearchResultKind,
  type TroveSearchResult,
} from '@/lib/search/api';

const LOCAL_SEARCH_DELAY_MS = 350;

function ResultIcon({ kind }: Readonly<{ kind: SearchResultKind }>) {
  const Icon = {
    memory: Sparkles,
    note: FileText,
    reservation: ReceiptText,
    saved_place: Bookmark,
    trip: Plane,
    trip_info: Info,
    trip_place: MapPinned,
  }[kind];
  return <Icon aria-hidden="true" />;
}

function ResultRow({
  onNavigate,
  result,
  sourceLabel,
  tripLabel,
}: Readonly<{
  onNavigate: () => void;
  result: TroveSearchResult;
  sourceLabel: string | null;
  tripLabel: string | null;
}>) {
  const description = [result.title ? sourceLabel : null, tripLabel, result.description]
    .filter(Boolean)
    .join(' · ');

  return (
    <Item render={<Link href={result.href} onClick={onNavigate} />} size="sm">
      <ItemMedia className="text-muted-foreground" variant="icon">
        <ResultIcon kind={result.kind} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{result.title || sourceLabel}</ItemTitle>
        {description ? <ItemDescription>{description}</ItemDescription> : null}
      </ItemContent>
    </Item>
  );
}

export function GlobalSearch() {
  const t = useTranslations('globalSearch');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading' | 'places' | 'ready'>('idle');
  const requestRef = useRef<AbortController | null>(null);
  const trimmedQuery = query.trim();

  const resultCount =
    response?.groups.reduce((total, group) => total + group.results.length, 0) ?? 0;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    requestRef.current?.abort();
    if (!open || trimmedQuery.length < 2) {
      setResponse(null);
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setStatus('loading');
    const timeout = window.setTimeout(() => {
      void searchTrove(trimmedQuery, { signal: controller.signal })
        .then((nextResponse) => {
          setResponse(nextResponse);
          setStatus('ready');
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setResponse(null);
          setStatus('error');
        });
    }, LOCAL_SEARCH_DELAY_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [open, trimmedQuery]);

  async function searchGooglePlaces() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus('places');
    try {
      const nextResponse = await searchTrove(trimmedQuery, {
        includePlaces: true,
        signal: controller.signal,
      });
      setResponse(nextResponse);
      setStatus('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus('ready');
      setResponse((current) =>
        current ? { ...current, external: { results: [], status: 'unavailable' } } : current,
      );
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={<Button aria-label={t('button')} size="icon" type="button" variant="ghost" />}
      >
        <Search aria-hidden="true" className="size-4" />
      </DialogTrigger>
      <DialogContent
        className="grid h-[min(42rem,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl sm:p-0"
        closeLabel={t('close')}
      >
        <DialogHeader className="border-b border-border p-5 pr-14 sm:p-6 sm:pr-16">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <DialogTitle>{t('title')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </div>
            <kbd className="hidden font-mono text-xs text-muted-foreground sm:block">
              {t('shortcut')}
            </kbd>
          </div>
          <SearchField
            autoFocus
            className="mt-3"
            label={t('label')}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('placeholder')}
            value={query}
          />
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto">
          <p aria-live="polite" className="sr-only" role="status">
            {status === 'loading'
              ? t('searching')
              : status === 'places'
                ? t('searchingGoogle')
                : status === 'ready'
                  ? t('resultCount', { count: resultCount })
                  : status === 'error'
                    ? t('errorTitle')
                    : ''}
          </p>
          {status === 'loading' ? <ContentSkeleton className="p-5 sm:p-6" shape="list" /> : null}
          {status === 'error' ? (
            <PageState
              className="min-h-48 justify-center px-6"
              description={t('errorDescription')}
              headingLevel={2}
              icon={<CircleAlert aria-hidden="true" />}
              kind="error"
              title={t('errorTitle')}
            />
          ) : null}
          {status === 'idle' ? (
            <PageState
              className="min-h-48 justify-center px-6"
              description={trimmedQuery.length === 1 ? t('minChars') : t('startDescription')}
              headingLevel={2}
              icon={<Search aria-hidden="true" />}
              title={t('startTitle')}
            />
          ) : null}
          {status !== 'idle' && status !== 'error' && status !== 'loading' && response ? (
            <div className="space-y-6 p-5 sm:p-6">
              {response.groups.length ? (
                response.groups.map((group) => (
                  <section aria-labelledby={`search-group-${group.kind}`} key={group.kind}>
                    <h3
                      className="mb-2 text-xs font-semibold text-muted-foreground"
                      id={`search-group-${group.kind}`}
                    >
                      {t(`groups.${group.kind}`)}
                    </h3>
                    <ItemGroup>
                      {group.results.map((result) => (
                        <ResultRow
                          key={`${result.kind}:${result.id}`}
                          onNavigate={close}
                          result={result}
                          sourceLabel={
                            result.noteSource ? t(`noteSources.${result.noteSource}`) : null
                          }
                          tripLabel={result.trip ? t('inTrip', { trip: result.trip.name }) : null}
                        />
                      ))}
                    </ItemGroup>
                  </section>
                ))
              ) : (
                <PageState
                  description={t('noResultsDescription')}
                  headingLevel={2}
                  scope="inline"
                  title={t('noResultsTitle')}
                />
              )}

              {response.external.status === 'ok' ? (
                <section
                  aria-labelledby="search-group-google"
                  className="border-t border-border pt-5"
                >
                  <h3
                    className="mb-1 text-xs font-semibold text-muted-foreground"
                    id="search-group-google"
                  >
                    {t('googleTitle')}
                  </h3>
                  <p className="mb-2 text-xs text-muted-foreground">{t('googleDescription')}</p>
                  <ItemGroup>
                    {response.external.results.map((place) => (
                      <Item
                        key={place.externalPlaceId}
                        render={
                          <a href={place.href} onClick={close} rel="noreferrer" target="_blank" />
                        }
                        size="sm"
                      >
                        <ItemMedia className="text-muted-foreground" variant="icon">
                          <MapPinned aria-hidden="true" />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle>{place.name}</ItemTitle>
                          {place.description ? (
                            <ItemDescription>{place.description}</ItemDescription>
                          ) : null}
                        </ItemContent>
                        <ExternalLink
                          aria-label={t('opensGoogle')}
                          className="size-4 text-muted-foreground"
                        />
                      </Item>
                    ))}
                  </ItemGroup>
                </section>
              ) : null}

              {response.external.status === 'unavailable' ? (
                <p className="border-t border-border pt-5 text-sm text-muted-foreground">
                  {t('googleUnavailable')}
                </p>
              ) : null}
              {response.external.status === 'empty' ? (
                <p className="border-t border-border pt-5 text-sm text-muted-foreground">
                  {t('googleEmpty')}
                </p>
              ) : null}
              {response.canSearchPlaces && response.external.status === 'not_requested' ? (
                <div className="border-t border-border pt-5">
                  <Button
                    disabled={status === 'places'}
                    onClick={() => void searchGooglePlaces()}
                    size="sm"
                    variant="outline"
                  >
                    <MapPinned data-icon="inline-start" />
                    {status === 'places' ? t('searchingGoogle') : t('searchGoogle')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
