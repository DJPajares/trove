'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Clock3, ExternalLink, FileText, Info, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { ContentSkeleton } from '@/components/content-skeleton';
import { localToday } from '@/components/saved/saved-ready-for-trip';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { queryKeys } from '@/lib/query/keys';
import {
  searchTrove,
  type SearchResponse,
  type SearchResultKind,
  type TroveSearchResult,
} from '@/lib/search/api';
import {
  readRecentSearches,
  rememberSearch,
  splitMatch,
  writeRecentSearches,
} from '@/lib/search/recent';
import { nextTripForTools } from '@/lib/tools/shelf';
import { fetchTrips } from '@/lib/trips/api';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

const LOCAL_SEARCH_DELAY_MS = 350;

/** One tile per kind, so a result reads as the thing it is before its name. */
const kindTiles: Record<SearchResultKind, { Icon: typeof Info; tone: string }> = {
  memory: { Icon: Icons.Memories, tone: 'bg-accent/25 text-accent-strong' },
  note: { Icon: FileText, tone: 'bg-surface-sunken text-muted-foreground' },
  reservation: { Icon: Icons.Reservations, tone: 'bg-status-warning/15 text-status-warning' },
  saved_place: { Icon: Icons.Saved, tone: 'bg-secondary text-secondary-foreground' },
  trip: { Icon: Icons.Trips, tone: 'bg-score-media-background text-score-media-brand' },
  trip_info: { Icon: Info, tone: 'bg-surface-sunken text-muted-foreground' },
  trip_place: { Icon: Icons.Places, tone: 'bg-secondary text-secondary-foreground' },
};

/** The chips narrow results by what they are, in the traveller's words. */
const scopes = {
  all: null,
  trips: ['trip'],
  places: ['trip_place', 'saved_place'],
  bookings: ['reservation'],
  memories: ['memory'],
  notes: ['note', 'trip_info'],
} as const satisfies Record<string, readonly SearchResultKind[] | null>;
type Scope = keyof typeof scopes;

function inScope(kind: SearchResultKind, scope: Scope) {
  const kinds = scopes[scope];
  return kinds === null || (kinds as readonly SearchResultKind[]).includes(kind);
}

function Highlighted({ query, text }: Readonly<{ query: string; text: string }>) {
  const [before, match, after] = splitMatch(text, query);
  return (
    <>
      {before}
      {match ? (
        <mark className="bg-transparent font-bold text-inherit underline decoration-score-media-brand decoration-2 underline-offset-3">
          {match}
        </mark>
      ) : null}
      {after}
    </>
  );
}

function Tile({ children, tone }: Readonly<{ children: ReactNode; tone: string }>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] [&_svg]:size-[1.125rem]',
        tone,
      )}
    >
      {children}
    </span>
  );
}

const rowClass =
  'flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-lg)] px-3 py-2 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40';

function ResultRow({
  onNavigate,
  query,
  result,
  sourceLabel,
  tripLabel,
}: Readonly<{
  onNavigate: () => void;
  query: string;
  result: TroveSearchResult;
  sourceLabel: string | null;
  tripLabel: string | null;
}>) {
  const { Icon, tone } = kindTiles[result.kind];
  const title = result.title || sourceLabel || '';
  const meta = [result.title ? sourceLabel : null, tripLabel, result.description]
    .filter(Boolean)
    .join(' · ');

  return (
    <li>
      <Link className={rowClass} data-search-item href={result.href} onClick={onNavigate}>
        <Tile tone={tone}>
          <Icon />
        </Tile>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            <Highlighted query={query} text={title} />
          </span>
          {meta ? (
            <span className="block truncate text-sm text-muted-foreground">
              <Highlighted query={query} text={meta} />
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

function Group({
  action,
  children,
  id,
  label,
}: Readonly<{ action?: ReactNode; children: ReactNode; id: string; label: string }>) {
  return (
    <section aria-labelledby={id} className="pt-3">
      <div className="flex min-h-8 items-center justify-between gap-2 px-3 pb-1">
        <h3
          className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase"
          id={id}
        >
          {label}
        </h3>
        {action}
      </div>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

type GlobalSearchProps = {
  /**
   * Where focus lands when a controlled dialog closes. Its opener is somewhere
   * the caller owns, and may well have unmounted while the dialog was up.
   */
  finalFocus?: RefObject<HTMLElement | null>;
  onNavigate?: () => void;
  onOpenChange?: (open: boolean) => void;
  /**
   * Pass this to drive the dialog from outside. A controlled search renders no
   * trigger of its own and leaves the keyboard shortcut to its owner, so the
   * two never race to open the same dialog.
   */
  open?: boolean;
};

/**
 * Search as a place to type, not a page to read: the field is the first line,
 * a full-height sheet on a phone and a palette on a desktop. Before typing it
 * offers the trip at hand and recent searches; after, the traveller's own
 * Trove grouped by kind, narrowed by chips. Google is asked only on request
 * and always after the Trove (PRD 16.3), because each lookup costs money.
 */
export function GlobalSearch({
  finalFocus,
  onNavigate,
  onOpenChange,
  open: openProp,
}: Readonly<GlobalSearchProps> = {}) {
  const t = useTranslations('globalSearch');
  const controlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlled ? openProp : uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [recent, setRecent] = useState<string[]>([]);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading' | 'places' | 'ready'>('idle');
  const requestRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const trimmedQuery = query.trim();
  // The trip list is shared with the Trips library, so reading it here is free.
  const trips = useQuery({ enabled: open, queryFn: fetchTrips, queryKey: queryKeys.trips() });
  const trip = open ? nextTripForTools(trips.data?.trips ?? [], localToday()) : null;

  useEffect(() => {
    if (open) setRecent(readRecentSearches());
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    onNavigate?.();
  }, [onNavigate, setOpen]);

  const openResult = useCallback(() => {
    const next = rememberSearch(readRecentSearches(), trimmedQuery);
    writeRecentSearches(next);
    close();
  }, [close, trimmedQuery]);

  useEffect(() => {
    if (controlled) return;

    function handleShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [controlled, setOpen]);

  useEffect(() => {
    requestRef.current?.abort();
    setScope('all');
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

  function updateRecent(next: string[]) {
    setRecent(next);
    writeRecentSearches(next);
  }

  // Arrow keys walk the results from the field and back, like a palette;
  // Enter on a focused result follows its link natively.
  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-search-item]') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      items[Math.min(index + 1, items.length - 1)]?.focus();
    } else if (index <= 0) {
      inputRef.current?.focus();
    } else {
      items[index - 1]?.focus();
    }
  }

  const allResults = response?.groups.flatMap((group) => group.results) ?? [];
  const counts = Object.fromEntries(
    (Object.keys(scopes) as Scope[]).map((key) => [
      key,
      allResults.filter((result) => inScope(result.kind, key)).length,
    ]),
  ) as Record<Scope, number>;
  const groups =
    response?.groups
      .map((group) => ({
        ...group,
        results: group.results.filter((result) => inScope(result.kind, scope)),
      }))
      .filter((group) => group.results.length) ?? [];
  const showResults = (status === 'ready' || status === 'places') && response;
  const canAskGoogle = Boolean(
    showResults && response.canSearchPlaces && response.external.status === 'not_requested',
  );

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      {controlled ? null : (
        <DialogTrigger
          render={<Button aria-label={t('button')} size="icon" type="button" variant="ghost" />}
        >
          <Search aria-hidden="true" className="size-4" />
        </DialogTrigger>
      )}
      <DialogContent
        className="grid grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:top-[12dvh] sm:h-[min(40rem,76dvh)] sm:max-w-2xl sm:translate-y-0 sm:p-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 max-sm:pt-[var(--safe-top)] max-sm:pb-[var(--safe-bottom)]"
        closeLabel={t('close')}
        finalFocus={finalFocus}
        initialFocus={inputRef}
        onKeyDown={moveFocus}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t('title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('description')}</DialogDescription>

        <div className="flex items-center gap-2 px-4 pt-4 pb-3 sm:border-b sm:border-border-subtle sm:px-5 sm:pt-3">
          <label className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-lg)] border border-border bg-card pr-1.5 pl-3.5 transition-[border-color,box-shadow] duration-[var(--motion-standard)] has-[input:focus-visible]:border-brand has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/30 sm:border-0 sm:bg-transparent sm:pl-0 sm:has-[input:focus-visible]:ring-0">
            <Search aria-hidden="true" className="size-[1.125rem] shrink-0 text-muted-foreground" />
            <span className="sr-only">{t('label')}</span>
            <input
              autoComplete="off"
              autoFocus
              className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-subtle sm:text-lg [&::-webkit-search-cancel-button]:hidden"
              enterKeyHint="search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('placeholder')}
              ref={inputRef}
              type="search"
              value={query}
            />
            {query ? (
              <Button
                aria-label={t('clear')}
                className="shrink-0 rounded-full text-muted-foreground"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </label>
          <DialogClose
            render={
              <Button
                className="shrink-0 px-2 text-brand sm:hidden"
                type="button"
                variant="ghost"
              />
            }
          >
            {t('cancel')}
          </DialogClose>
          <kbd className="hidden shrink-0 rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 font-sans text-xs text-muted-foreground sm:block">
            esc
          </kbd>
        </div>

        {showResults && allResults.length ? (
          <div
            aria-label={t('scopeLabel')}
            className="flex gap-1.5 overflow-x-auto border-b border-border-subtle px-4 pb-3 [scrollbar-width:none] sm:px-5 sm:py-3"
            role="group"
          >
            {(Object.keys(scopes) as Scope[])
              .filter((key) => key === 'all' || counts[key] > 0)
              .map((key) => (
                <Button
                  aria-pressed={scope === key}
                  className="h-9 shrink-0 rounded-full px-3.5 text-[0.8125rem] tabular-nums shadow-none"
                  key={key}
                  onClick={() => setScope(key)}
                  size="sm"
                  type="button"
                  variant={scope === key ? 'default' : 'outline'}
                >
                  {t('scopeCount', { count: counts[key], label: t(`scopes.${key}`) })}
                </Button>
              ))}
          </div>
        ) : (
          <div className="border-b border-border-subtle sm:hidden" />
        )}

        <div className="min-h-0 overflow-y-auto px-1.5 pb-4 sm:px-2" ref={listRef}>
          <p aria-live="polite" className="sr-only" role="status">
            {status === 'loading'
              ? t('searching')
              : status === 'places'
                ? t('searchingGoogle')
                : status === 'ready'
                  ? t('resultCount', { count: allResults.length })
                  : status === 'error'
                    ? t('errorTitle')
                    : ''}
          </p>

          {status === 'idle' ? (
            <>
              {trimmedQuery.length === 1 ? (
                <p className="px-3 pt-4 text-sm text-muted-foreground">{t('minChars')}</p>
              ) : null}
              {trip ? (
                <Group id="search-trip" label={trip.name}>
                  {(
                    [
                      [
                        'itinerary',
                        Icons.Itinerary,
                        'bg-score-media-background text-score-media-brand',
                      ],
                      ['places', Icons.Places, 'bg-secondary text-secondary-foreground'],
                      [
                        'reservations',
                        Icons.Reservations,
                        'bg-status-warning/15 text-status-warning',
                      ],
                    ] as const
                  ).map(([section, Icon, tone]) => (
                    <li key={section}>
                      <Link
                        className={rowClass}
                        data-search-item
                        href={`/trips/${trip.id}/${section}`}
                        onClick={close}
                      >
                        <Tile tone={tone}>
                          <Icon />
                        </Tile>
                        <span className="flex-1 font-semibold">{t(`shortcuts.${section}`)}</span>
                      </Link>
                    </li>
                  ))}
                </Group>
              ) : null}
              {recent.length ? (
                <Group
                  action={
                    <Button
                      className="h-8 px-2 text-brand"
                      onClick={() => updateRecent([])}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t('clearRecent')}
                    </Button>
                  }
                  id="search-recent"
                  label={t('recent')}
                >
                  {recent.map((entry) => (
                    <li className="flex items-center" key={entry}>
                      <button
                        className={cn(rowClass, 'min-h-12 flex-1')}
                        data-search-item
                        onClick={() => {
                          setQuery(entry);
                          inputRef.current?.focus();
                        }}
                        type="button"
                      >
                        <Clock3
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="truncate">{entry}</span>
                      </button>
                      <Button
                        aria-label={t('removeRecent', { query: entry })}
                        className="shrink-0 text-muted-foreground"
                        onClick={() => updateRecent(recent.filter((item) => item !== entry))}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </Group>
              ) : null}
              {!trip && !recent.length && trimmedQuery.length !== 1 ? (
                <p className="px-3 pt-5 text-sm text-muted-foreground">{t('startDescription')}</p>
              ) : null}
            </>
          ) : null}

          {status === 'loading' ? <ContentSkeleton className="p-3" shape="list" /> : null}

          {status === 'error' ? (
            <div className="flex gap-3 px-3 pt-5" role="alert">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <p className="font-semibold">{t('errorTitle')}</p>
                <p className="text-sm text-muted-foreground">{t('errorDescription')}</p>
              </div>
            </div>
          ) : null}

          {showResults ? (
            <>
              {groups.map((group) => (
                <Group
                  id={`search-group-${group.kind}`}
                  key={group.kind}
                  label={t(`groups.${group.kind}`)}
                >
                  {group.results.map((result) => (
                    <ResultRow
                      key={`${result.kind}:${result.id}`}
                      onNavigate={openResult}
                      query={trimmedQuery}
                      result={result}
                      sourceLabel={result.noteSource ? t(`noteSources.${result.noteSource}`) : null}
                      tripLabel={result.trip ? t('inTrip', { trip: result.trip.name }) : null}
                    />
                  ))}
                </Group>
              ))}
              {!allResults.length ? (
                <div className="px-3 pt-5">
                  <p className="font-semibold">{t('noMatch', { query: trimmedQuery })}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t('noMatchHint')}</p>
                </div>
              ) : null}

              {response.external.status === 'ok' ? (
                <Group
                  action={
                    <span className="text-xs text-muted-foreground">{t('googleNotSaved')}</span>
                  }
                  id="search-group-google"
                  label={t('googleTitle')}
                >
                  {response.external.results.map((place) => (
                    <li key={place.externalPlaceId}>
                      <a
                        className={rowClass}
                        data-search-item
                        href={place.href}
                        onClick={close}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <Tile tone="border border-border text-muted-foreground">
                          <Icons.Place />
                        </Tile>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{place.name}</span>
                          {place.description ? (
                            <span className="block truncate text-sm text-muted-foreground">
                              {place.description}
                            </span>
                          ) : null}
                        </span>
                        <ExternalLink
                          aria-label={t('opensGoogle')}
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                      </a>
                    </li>
                  ))}
                </Group>
              ) : null}
              {response.external.status === 'unavailable' ? (
                <p className="px-3 pt-5 text-sm text-muted-foreground">{t('googleUnavailable')}</p>
              ) : null}
              {response.external.status === 'empty' ? (
                <p className="px-3 pt-5 text-sm text-muted-foreground">{t('googleEmpty')}</p>
              ) : null}
            </>
          ) : null}
        </div>

        <div
          className={cn(
            'flex items-center gap-3 border-t border-border-subtle px-4 py-3 sm:bg-background sm:px-5',
            // On a phone the footer only exists to ask Google; on a desktop it
            // also carries the keyboard hints.
            !canAskGoogle && status !== 'places' && 'max-sm:hidden',
          )}
        >
          {canAskGoogle || status === 'places' ? (
            <button
              className="flex min-h-12 flex-1 flex-col justify-center rounded-[var(--radius-lg)] border border-dashed border-border-strong px-3.5 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60 sm:min-h-10 sm:flex-none sm:flex-row sm:items-center sm:gap-2 sm:rounded-full"
              disabled={status === 'places'}
              onClick={() => void searchGooglePlaces()}
              type="button"
            >
              <span className="text-sm font-semibold">
                {status === 'places'
                  ? t('searchingGoogle')
                  : t('lookUpGoogle', { query: trimmedQuery })}
              </span>
              <span className="text-xs text-muted-foreground sm:hidden">
                {t('lookUpGoogleHint')}
              </span>
            </button>
          ) : null}
          <p className="ml-auto hidden text-xs text-muted-foreground sm:block">{t('keyHints')}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
