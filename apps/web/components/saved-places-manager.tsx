'use client';

import {
  Bookmark,
  Check,
  CircleAlert,
  FolderPlus,
  MapPinned,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { SearchField } from '@/components/search-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  addToCollection,
  cacheProviderPlaceDetails,
  createCollection,
  createCustomPlace,
  fetchSavedPlaces,
  GOOGLE_PLACES_SEARCH_DEBOUNCE_MS,
  getProviderPlaceDetails,
  removeCollection,
  removeFromCollection,
  renameCollection,
  resolveProviderPlace,
  saveCanonicalPlace,
  SavedApiError,
  type ProviderPlaceDetails,
  type ProviderSuggestion,
  type SavedCollection,
  type SavedPlace,
  searchProviderPlaces,
  unsavePlace,
  updateSavedPlaceNote,
} from '@/lib/saved/api';
import { cn } from '@/lib/utils';

type CollectionEditor =
  { collection: null; mode: 'closed' | 'create' } | { collection: SavedCollection; mode: 'rename' };
type CategoryFilter = 'all' | ProviderSuggestion['category'];
type ProviderDetailsByPlaceId = Record<string, ProviderPlaceDetails | null | undefined>;

const categoryFilters: CategoryFilter[] = [
  'all',
  'food_and_drink',
  'things_to_do',
  'stay',
  'shopping',
];

function sortCollections(collections: SavedCollection[]) {
  return collections.toSorted((left, right) => left.name.localeCompare(right.name));
}

export function SavedPlacesManager() {
  const t = useTranslations('saved');
  const locale = useLocale();
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [collections, setCollections] = useState<SavedCollection[]>([]);
  const [providerDetails, setProviderDetails] = useState<ProviderDetailsByPlaceId>({});
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<'custom' | 'search'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProviderSuggestion[]>([]);
  const [searchStatus, setSearchStatus] = useState<'empty' | 'idle' | 'loading' | 'unavailable'>(
    'idle',
  );
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');
  const [customNote, setCustomNote] = useState('');
  const [savingCustom, setSavingCustom] = useState(false);
  const [collectionEditor, setCollectionEditor] = useState<CollectionEditor>({
    collection: null,
    mode: 'closed',
  });
  const [collectionName, setCollectionName] = useState('');
  const [savingCollection, setSavingCollection] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState<SavedCollection | null>(null);
  const [collectionPickerPlace, setCollectionPickerPlace] = useState<SavedPlace | null>(null);
  const [togglingCollectionId, setTogglingCollectionId] = useState<string | null>(null);
  const [noteEditorPlace, setNoteEditorPlace] = useState<SavedPlace | null>(null);
  const [noteValue, setNoteValue] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [unsavingPlaceId, setUnsavingPlaceId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus('loading');
    setError(null);

    try {
      const result = await fetchSavedPlaces();
      setCollections(result.collections);
      setSavedPlaces(result.savedPlaces);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unresolvedProviderPlaces = savedPlaces.filter(
      (savedPlace) =>
        savedPlace.place.kind === 'provider' &&
        providerDetails[savedPlace.place.id] === undefined &&
        savedPlace.place.providerRefs[0],
    );
    if (unresolvedProviderPlaces.length === 0) return;

    let active = true;

    void Promise.all(
      unresolvedProviderPlaces.map(async (savedPlace) => {
        const externalPlaceId = savedPlace.place.providerRefs[0]?.externalPlaceId;
        if (!externalPlaceId) return { placeId: savedPlace.place.id, details: null };

        try {
          const result = await getProviderPlaceDetails(externalPlaceId);
          const details = result.status === 'ok' ? (result.place ?? null) : null;
          if (details) cacheProviderPlaceDetails(savedPlace.place.id, details);
          return {
            placeId: savedPlace.place.id,
            details,
          };
        } catch {
          return { placeId: savedPlace.place.id, details: null };
        }
      }),
    ).then((results) => {
      if (!active) return;
      setProviderDetails((current) => ({
        ...current,
        ...Object.fromEntries(results.map((result) => [result.placeId, result.details])),
      }));
    });

    return () => {
      active = false;
    };
  }, [providerDetails, savedPlaces]);

  useEffect(() => {
    const input = searchQuery.trim();
    if (!input) {
      setSearchResults([]);
      setSearchStatus('idle');
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearchStatus('loading');
      void searchProviderPlaces(input, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result.status === 'unavailable') {
            setSearchResults([]);
            setSearchStatus('unavailable');
            return;
          }
          setSearchResults(result.suggestions ?? []);
          setSearchStatus(result.status === 'empty' ? 'empty' : 'idle');
        })
        .catch((cause: unknown) => {
          if (
            controller.signal.aborted ||
            (cause instanceof DOMException && cause.name === 'AbortError')
          ) {
            return;
          }
          setSearchResults([]);
          setSearchStatus('unavailable');
        });
    }, GOOGLE_PLACES_SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [searchQuery]);

  const activeCollection =
    collections.find((collection) => collection.id === activeCollectionId) ?? null;
  const visibleSavedPlaces = useMemo(
    () =>
      savedPlaces.filter((savedPlace) => {
        const belongsToActiveCollection =
          !activeCollectionId ||
          savedPlace.collections.some((collection) => collection.id === activeCollectionId);
        if (!belongsToActiveCollection) return false;
        if (categoryFilter === 'all') return true;
        return providerDetails[savedPlace.place.id]?.category === categoryFilter;
      }),
    [activeCollectionId, categoryFilter, providerDetails, savedPlaces],
  );

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    [locale],
  );

  function getPlaceName(savedPlace: SavedPlace) {
    if (savedPlace.place.kind === 'custom') {
      return savedPlace.place.name ?? t('customPlace');
    }
    return providerDetails[savedPlace.place.id]?.name ?? t('providerPlace');
  }

  function getPlaceDescription(savedPlace: SavedPlace) {
    if (savedPlace.place.kind === 'custom') {
      return savedPlace.place.note ?? t('customPlaceDescription');
    }

    return (
      providerDetails[savedPlace.place.id]?.formattedAddress ?? t('providerDetailsUnavailable')
    );
  }

  function getErrorMessage(errorValue: unknown) {
    if (
      errorValue instanceof SavedApiError &&
      errorValue.code === 'saved_collection_name_conflict'
    ) {
      return t('collectionNameConflict');
    }
    return t('actionError');
  }

  function resetAddForm() {
    setAddMode('search');
    setCustomName('');
    setCustomNote('');
    setSearchQuery('');
    setSearchResults([]);
    setSearchStatus('idle');
  }

  async function handleProviderSave(suggestion: ProviderSuggestion) {
    setSavingProviderId(suggestion.externalPlaceId);
    setError(null);

    try {
      const { place } = await resolveProviderPlace(suggestion.externalPlaceId);
      const { savedPlace } = await saveCanonicalPlace(place.id);
      setSavedPlaces((current) => [
        savedPlace,
        ...current.filter((item) => item.id !== savedPlace.id),
      ]);
      setProviderDetails((current) => ({
        ...current,
        [place.id]: {
          category: suggestion.category,
          formattedAddress: suggestion.description,
          name: suggestion.name,
        },
      }));
      cacheProviderPlaceDetails(place.id, {
        category: suggestion.category,
        formattedAddress: suggestion.description,
        name: suggestion.name,
      });
      setAddOpen(false);
      resetAddForm();
    } catch (errorValue) {
      setError(getErrorMessage(errorValue));
    } finally {
      setSavingProviderId(null);
    }
  }

  async function handleCustomSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customName.trim()) return;

    setSavingCustom(true);
    setError(null);

    try {
      const { place } = await createCustomPlace({
        name: customName,
        note: customNote || null,
      });
      const { savedPlace } = await saveCanonicalPlace(place.id);
      setSavedPlaces((current) => [
        savedPlace,
        ...current.filter((item) => item.id !== savedPlace.id),
      ]);
      setAddOpen(false);
      resetAddForm();
    } catch (errorValue) {
      setError(getErrorMessage(errorValue));
    } finally {
      setSavingCustom(false);
    }
  }

  async function handleUnsave(savedPlace: SavedPlace) {
    setUnsavingPlaceId(savedPlace.id);
    setError(null);

    try {
      await unsavePlace(savedPlace.id);
      setSavedPlaces((current) => current.filter((item) => item.id !== savedPlace.id));
      setCollections((current) =>
        current.map((collection) => ({
          ...collection,
          placeCount: Math.max(
            0,
            collection.placeCount -
              Number(savedPlace.collections.some((item) => item.id === collection.id)),
          ),
        })),
      );
      if (collectionPickerPlace?.id === savedPlace.id) setCollectionPickerPlace(null);
    } catch (errorValue) {
      setError(getErrorMessage(errorValue));
    } finally {
      setUnsavingPlaceId(null);
    }
  }

  function openCollectionEditor(
    mode: CollectionEditor['mode'],
    collection: SavedCollection | null = null,
  ) {
    if (mode === 'closed') {
      setCollectionEditor({ collection: null, mode: 'closed' });
      return;
    }
    setCollectionName(collection?.name ?? '');
    setCollectionEditor(
      mode === 'rename' && collection ? { collection, mode } : { collection: null, mode: 'create' },
    );
  }

  async function handleCollectionSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!collectionName.trim()) return;

    setSavingCollection(true);
    setError(null);

    try {
      if (collectionEditor.mode === 'rename') {
        const { collection } = await renameCollection(
          collectionEditor.collection.id,
          collectionName,
        );
        setCollections((current) =>
          sortCollections(current.map((item) => (item.id === collection.id ? collection : item))),
        );
        setSavedPlaces((current) =>
          current.map((savedPlace) => ({
            ...savedPlace,
            collections: savedPlace.collections.map((item) =>
              item.id === collection.id ? { id: collection.id, name: collection.name } : item,
            ),
          })),
        );
      } else {
        const { collection } = await createCollection(collectionName);
        setCollections((current) => sortCollections([...current, collection]));
      }
      openCollectionEditor('closed');
    } catch (errorValue) {
      setError(getErrorMessage(errorValue));
    } finally {
      setSavingCollection(false);
    }
  }

  async function handleCollectionDelete() {
    if (!collectionToDelete) return;

    setError(null);
    try {
      await removeCollection(collectionToDelete.id);
      setCollections((current) =>
        current.filter((collection) => collection.id !== collectionToDelete.id),
      );
      setSavedPlaces((current) =>
        current.map((savedPlace) => ({
          ...savedPlace,
          collections: savedPlace.collections.filter((item) => item.id !== collectionToDelete.id),
        })),
      );
      if (activeCollectionId === collectionToDelete.id) setActiveCollectionId(null);
      setCollectionToDelete(null);
    } catch (errorValue) {
      setError(getErrorMessage(errorValue));
    }
  }

  async function handleCollectionMembership(collection: SavedCollection) {
    if (!collectionPickerPlace) return;
    const savedPlace = collectionPickerPlace;
    const isMember = savedPlace.collections.some((item) => item.id === collection.id);
    setTogglingCollectionId(collection.id);
    setError(null);

    try {
      if (isMember) {
        await removeFromCollection(savedPlace.id, collection.id);
      } else {
        await addToCollection(savedPlace.id, collection.id);
      }

      const nextCollections = isMember
        ? savedPlace.collections.filter((item) => item.id !== collection.id)
        : [...savedPlace.collections, { id: collection.id, name: collection.name }];
      const nextSavedPlace = { ...savedPlace, collections: nextCollections };
      setCollectionPickerPlace(nextSavedPlace);
      setSavedPlaces((current) =>
        current.map((item) => (item.id === savedPlace.id ? nextSavedPlace : item)),
      );
      setCollections((current) =>
        current.map((item) =>
          item.id === collection.id
            ? { ...item, placeCount: Math.max(0, item.placeCount + (isMember ? -1 : 1)) }
            : item,
        ),
      );
    } catch (errorValue) {
      setError(getErrorMessage(errorValue));
    } finally {
      setTogglingCollectionId(null);
    }
  }

  function openNoteEditor(savedPlace: SavedPlace) {
    setNoteEditorPlace(savedPlace);
    setNoteValue(savedPlace.note ?? '');
  }

  async function handleNoteSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!noteEditorPlace) return;
    setSavingNote(true);
    setError(null);

    try {
      const { savedPlace } = await updateSavedPlaceNote(noteEditorPlace.id, noteValue || null);
      setSavedPlaces((current) =>
        current.map((item) => (item.id === savedPlace.id ? savedPlace : item)),
      );
      setNoteEditorPlace(null);
    } catch (errorValue) {
      setError(getErrorMessage(errorValue));
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-6xl space-y-8">
      <PageHeader
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('addPlace')}
          </Button>
        }
        description={t('description')}
        title={t('title')}
      />

      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {status === 'loading' ? (
        <PageState headingLevel={2} kind="loading" title={t('loading')} />
      ) : status === 'error' ? (
        <PageState
          actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
          description={t('loadErrorDescription')}
          headingLevel={2}
          icon={<CircleAlert aria-hidden="true" />}
          kind="error"
          title={t('loadError')}
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
          <aside className="min-w-0 lg:border-r lg:border-border lg:pr-6">
            <div className="flex items-center justify-between gap-3 lg:mb-3">
              <h2 className="text-sm font-medium text-foreground">{t('collectionsTitle')}</h2>
              <Button
                aria-label={t('createCollection')}
                onClick={() => openCollectionEditor('create')}
                size="icon-xs"
                variant="ghost"
              >
                <FolderPlus aria-hidden="true" />
              </Button>
            </div>
            <div
              aria-label={t('collectionsTitle')}
              className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
            >
              <Button
                aria-pressed={!activeCollectionId}
                className="justify-start"
                onClick={() => setActiveCollectionId(null)}
                size="sm"
                variant={activeCollectionId ? 'ghost' : 'secondary'}
              >
                {t('allSaved')}
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {savedPlaces.length}
                </span>
              </Button>
              {collections.map((collection) => (
                <div className="flex min-w-max items-center gap-0.5 lg:min-w-0" key={collection.id}>
                  <Button
                    aria-pressed={activeCollectionId === collection.id}
                    className="min-w-0 flex-1 justify-start"
                    onClick={() => setActiveCollectionId(collection.id)}
                    size="sm"
                    variant={activeCollectionId === collection.id ? 'secondary' : 'ghost'}
                  >
                    <span className="truncate">{collection.name}</span>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {collection.placeCount}
                    </span>
                  </Button>
                  <Button
                    aria-label={t('editCollection', { name: collection.name })}
                    onClick={() => openCollectionEditor('rename', collection)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          </aside>

          <div className="min-w-0 space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-foreground">
                  {activeCollection?.name ?? t('allSaved')}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('placeCount', { count: visibleSavedPlaces.length })}
                </p>
              </div>
              <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:mx-0 sm:max-w-[32rem] sm:px-0">
                {categoryFilters.map((filter) => (
                  <Button
                    aria-pressed={categoryFilter === filter}
                    className="min-w-max"
                    key={filter}
                    onClick={() => setCategoryFilter(filter)}
                    size="sm"
                    variant={categoryFilter === filter ? 'secondary' : 'ghost'}
                  >
                    {t(`categories.${filter}`)}
                  </Button>
                ))}
              </div>
            </div>

            {savedPlaces.length === 0 ? (
              <PageState
                actions={
                  <Button onClick={() => setAddOpen(true)}>
                    <Plus aria-hidden="true" data-icon="inline-start" />
                    {t('addFirstPlace')}
                  </Button>
                }
                description={t('emptyDescription')}
                headingLevel={2}
                icon={<Bookmark aria-hidden="true" />}
                kind="empty"
                title={t('emptyTitle')}
              />
            ) : visibleSavedPlaces.length === 0 ? (
              <PageState
                description={
                  activeCollection
                    ? t('collectionEmptyDescription', { name: activeCollection.name })
                    : t('filterEmptyDescription')
                }
                headingLevel={2}
                icon={<Search aria-hidden="true" />}
                kind="empty"
                title={t('filterEmptyTitle')}
              />
            ) : (
              <ItemGroup aria-label={t('listLabel')} variant="list">
                {visibleSavedPlaces.map((savedPlace) => {
                  const category = providerDetails[savedPlace.place.id]?.category;
                  return (
                    <Item
                      className="min-h-20 flex-nowrap px-3 py-3 text-left hover:bg-muted/60"
                      key={savedPlace.id}
                      variant="default"
                    >
                      <ItemMedia
                        className={cn(
                          'size-11 rounded-[var(--radius-md)] sm:size-12',
                          savedPlace.place.kind === 'custom'
                            ? 'bg-secondary text-secondary-foreground'
                            : 'bg-brand/10 text-brand',
                        )}
                        variant="icon"
                      >
                        {savedPlace.place.kind === 'custom' ? (
                          <NotebookPen aria-hidden="true" className="size-5" />
                        ) : (
                          <MapPinned aria-hidden="true" className="size-5" />
                        )}
                      </ItemMedia>
                      <ItemContent className="min-w-0 gap-1.5">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <ItemTitle className="max-w-full text-base">
                            {getPlaceName(savedPlace)}
                          </ItemTitle>
                          {category ? (
                            <span className="text-xs font-medium text-text-subtle">
                              {t(`categories.${category}`)}
                            </span>
                          ) : null}
                        </div>
                        <ItemDescription className="line-clamp-1">
                          {getPlaceDescription(savedPlace)}
                        </ItemDescription>
                        <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs leading-5 text-text-subtle">
                          <span>
                            {t('savedOn', {
                              date: dateFormatter.format(new Date(savedPlace.createdAt)),
                            })}
                          </span>
                          {savedPlace.collections.length ? (
                            <span>
                              {savedPlace.collections
                                .map((collection) => collection.name)
                                .join(', ')}
                            </span>
                          ) : null}
                          {savedPlace.note ? <span>{savedPlace.note}</span> : null}
                        </div>
                      </ItemContent>
                      <ItemActions className="shrink-0 self-start">
                        <Button
                          aria-label={t('manageCollections', { name: getPlaceName(savedPlace) })}
                          onClick={() => setCollectionPickerPlace(savedPlace)}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <FolderPlus aria-hidden="true" />
                        </Button>
                        <Button
                          aria-label={t('editNote', { name: getPlaceName(savedPlace) })}
                          onClick={() => openNoteEditor(savedPlace)}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          aria-label={t('unsave', { name: getPlaceName(savedPlace) })}
                          disabled={unsavingPlaceId === savedPlace.id}
                          onClick={() => void handleUnsave(savedPlace)}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </ItemActions>
                    </Item>
                  );
                })}
              </ItemGroup>
            )}
          </div>
        </div>
      )}

      <Sheet
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetAddForm();
        }}
        open={addOpen}
      >
        <SheetContent
          className="data-[side=right]:w-[min(34rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
        >
          <SheetHeader className="border-b">
            <SheetTitle>{t('addPlaceTitle')}</SheetTitle>
            <SheetDescription>{t('addPlaceDescription')}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto p-5">
            {addMode === 'search' ? (
              <div className="space-y-5">
                <SearchField
                  autoFocus
                  label={t('searchLabel')}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t('searchPlaceholder')}
                  value={searchQuery}
                />
                {!searchQuery.trim() ? (
                  <p className="text-sm leading-6 text-muted-foreground">{t('searchHint')}</p>
                ) : searchStatus === 'loading' ? (
                  <p aria-live="polite" className="text-sm text-muted-foreground" role="status">
                    {t('searching')}
                  </p>
                ) : searchStatus === 'unavailable' ? (
                  <Alert role="alert" variant="destructive">
                    <CircleAlert aria-hidden="true" />
                    <AlertDescription>{t('searchUnavailable')}</AlertDescription>
                  </Alert>
                ) : searchStatus === 'empty' ? (
                  <p className="text-sm leading-6 text-muted-foreground">{t('searchEmpty')}</p>
                ) : (
                  <ItemGroup aria-label={t('searchResults')} className="gap-2">
                    {searchResults.map((suggestion) => (
                      <Item
                        className="px-3 py-3"
                        key={suggestion.externalPlaceId}
                        variant="outline"
                      >
                        <ItemMedia
                          className="size-10 rounded-[var(--radius-md)] bg-brand/10 text-brand"
                          variant="icon"
                        >
                          <MapPinned aria-hidden="true" />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle>{suggestion.name}</ItemTitle>
                          <ItemDescription>
                            {suggestion.description ?? t('providerPlace')}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <Button
                            disabled={savingProviderId === suggestion.externalPlaceId}
                            onClick={() => void handleProviderSave(suggestion)}
                            size="sm"
                          >
                            {savingProviderId === suggestion.externalPlaceId
                              ? t('saving')
                              : t('save')}
                          </Button>
                        </ItemActions>
                      </Item>
                    ))}
                  </ItemGroup>
                )}
                <Button className="px-0" onClick={() => setAddMode('custom')} variant="link">
                  {t('createCustomPlace')}
                </Button>
              </div>
            ) : (
              <form className="space-y-5" onSubmit={(event) => void handleCustomSave(event)}>
                <div className="space-y-2">
                  <Label htmlFor="custom-place-name">{t('customName')}</Label>
                  <Input
                    autoFocus
                    id="custom-place-name"
                    onChange={(event) => setCustomName(event.target.value)}
                    placeholder={t('customNamePlaceholder')}
                    required
                    value={customName}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custom-place-note">{t('customNote')}</Label>
                  <Input
                    id="custom-place-note"
                    onChange={(event) => setCustomNote(event.target.value)}
                    placeholder={t('customNotePlaceholder')}
                    value={customNote}
                  />
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button disabled={savingCustom || !customName.trim()} type="submit">
                    {savingCustom ? t('saving') : t('savePlace')}
                  </Button>
                  <Button onClick={() => setAddMode('search')} type="button" variant="outline">
                    {t('backToSearch')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        onOpenChange={(open) => {
          if (!open) openCollectionEditor('closed');
        }}
        open={collectionEditor.mode !== 'closed'}
      >
        <DialogContent closeLabel={t('close')}>
          <form onSubmit={(event) => void handleCollectionSave(event)}>
            <DialogHeader>
              <DialogTitle>
                {collectionEditor.mode === 'rename'
                  ? t('renameCollectionTitle')
                  : t('createCollectionTitle')}
              </DialogTitle>
              <DialogDescription>
                {collectionEditor.mode === 'rename'
                  ? t('renameCollectionDescription')
                  : t('createCollectionDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 space-y-2">
              <Label htmlFor="saved-collection-name">{t('collectionName')}</Label>
              <Input
                autoFocus
                id="saved-collection-name"
                onChange={(event) => setCollectionName(event.target.value)}
                required
                value={collectionName}
              />
            </div>
            <DialogFooter>
              {collectionEditor.mode === 'rename' ? (
                <Button
                  className="sm:mr-auto"
                  onClick={() => setCollectionToDelete(collectionEditor.collection)}
                  type="button"
                  variant="destructive"
                >
                  {t('deleteCollection')}
                </Button>
              ) : null}
              <Button
                disabled={savingCollection}
                onClick={() => openCollectionEditor('closed')}
                type="button"
                variant="outline"
              >
                {t('cancel')}
              </Button>
              <Button disabled={savingCollection || !collectionName.trim()} type="submit">
                {savingCollection ? t('saving') : t('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(collectionToDelete)}
        onOpenChange={(open) => !open && setCollectionToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteCollectionTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteCollectionDescription', { name: collectionToDelete?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleCollectionDelete()} variant="destructive">
              {t('deleteCollection')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setCollectionPickerPlace(null);
        }}
        open={Boolean(collectionPickerPlace)}
      >
        <DialogContent closeLabel={t('close')}>
          <DialogHeader>
            <DialogTitle>{t('manageCollectionsTitle')}</DialogTitle>
            <DialogDescription>
              {t('manageCollectionsDescription', {
                name: collectionPickerPlace ? getPlaceName(collectionPickerPlace) : '',
              })}
            </DialogDescription>
          </DialogHeader>
          {collections.length ? (
            <div className="mt-1 space-y-1">
              {collections.map((collection) => {
                const selected = collectionPickerPlace?.collections.some(
                  (item) => item.id === collection.id,
                );
                return (
                  <Button
                    aria-pressed={selected}
                    className="w-full justify-between"
                    disabled={togglingCollectionId === collection.id}
                    key={collection.id}
                    onClick={() => void handleCollectionMembership(collection)}
                    variant={selected ? 'secondary' : 'ghost'}
                  >
                    <span>{collection.name}</span>
                    {selected ? <Check aria-hidden="true" /> : null}
                  </Button>
                );
              })}
            </div>
          ) : (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('noCollections')}</p>
          )}
          <DialogFooter>
            <Button
              onClick={() => {
                setCollectionPickerPlace(null);
                openCollectionEditor('create');
              }}
              variant="outline"
            >
              <FolderPlus aria-hidden="true" data-icon="inline-start" />
              {t('createCollection')}
            </Button>
            <Button onClick={() => setCollectionPickerPlace(null)}>{t('done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(noteEditorPlace)}
        onOpenChange={(open) => !open && setNoteEditorPlace(null)}
      >
        <DialogContent closeLabel={t('close')}>
          <form onSubmit={(event) => void handleNoteSave(event)}>
            <DialogHeader>
              <DialogTitle>{t('editNoteTitle')}</DialogTitle>
              <DialogDescription>
                {t('editNoteDescription', {
                  name: noteEditorPlace ? getPlaceName(noteEditorPlace) : '',
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 space-y-2">
              <Label htmlFor="saved-place-note">{t('personalNote')}</Label>
              <Input
                autoFocus
                id="saved-place-note"
                onChange={(event) => setNoteValue(event.target.value)}
                placeholder={t('personalNotePlaceholder')}
                value={noteValue}
              />
            </div>
            <DialogFooter>
              <Button
                disabled={savingNote}
                onClick={() => setNoteEditorPlace(null)}
                type="button"
                variant="outline"
              >
                {t('cancel')}
              </Button>
              <Button disabled={savingNote} type="submit">
                {savingNote ? t('saving') : t('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
