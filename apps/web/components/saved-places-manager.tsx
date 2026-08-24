'use client';

import {
  Bookmark,
  Check,
  CircleAlert,
  Ellipsis,
  Eye,
  FolderPlus,
  MapPinned,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { MediaAttribution } from '@/components/media-attribution';
import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { PlaceMedia } from '@/components/place-media';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  createCollection,
  createCustomPlace,
  fetchSavedPlaces,
  GOOGLE_PLACES_SEARCH_DEBOUNCE_MS,
  googleMapsPlaceHref,
  removeCollection,
  removeFromCollection,
  renameCollection,
  resolveProviderPlace,
  saveCanonicalPlace,
  SavedApiError,
  type ProviderSuggestion,
  type SavedCollection,
  type SavedPlace,
  searchProviderPlaces,
  unsavePlace,
  updateSavedPlaceNote,
} from '@/lib/saved/api';
import { PROVIDER_SEARCH_RESULT_LIMIT } from '@/lib/saved/search-results';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import {
  editorialSubjectKey,
  MAX_EDITORIAL_IMAGE_SUBJECTS,
  type EditorialSubject,
} from '@/lib/media/editorial-images';
import { resolvePlaceMediaSource } from '@/lib/media/trip-media';
import {
  removeSavedPlaceState,
  updateCollectionMembershipState,
} from '@/lib/saved/collection-membership';

type CollectionEditor =
  { collection: null; mode: 'closed' | 'create' } | { collection: SavedCollection; mode: 'rename' };
type CategoryFilter = 'all' | ProviderSuggestion['category'];
const categoryFilters: CategoryFilter[] = [
  'all',
  'destination',
  'things_to_do',
  'food_and_drink',
  'stay',
  'shopping',
  'transport',
  'other',
];
/** A ChipGroup value has to be a string; a saved collection's own id never collides with this. */
const ALL_COLLECTIONS_VALUE = '__all__';

function sortCollections(collections: SavedCollection[]) {
  return collections.toSorted((left, right) => left.name.localeCompare(right.name));
}

export function SavedPlacesManager() {
  const t = useTranslations('saved');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [collections, setCollections] = useState<SavedCollection[]>([]);
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
  const [collectionCreateTarget, setCollectionCreateTarget] = useState<SavedPlace | null>(null);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [togglingCollectionId, setTogglingCollectionId] = useState<string | null>(null);
  const [noteEditorPlace, setNoteEditorPlace] = useState<SavedPlace | null>(null);
  const [noteValue, setNoteValue] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [savedPlaceToUnsave, setSavedPlaceToUnsave] = useState<SavedPlace | null>(null);
  const [unsaveError, setUnsaveError] = useState<string | null>(null);
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
          setSearchResults((result.suggestions ?? []).slice(0, PROVIDER_SEARCH_RESULT_LIMIT));
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
        return savedPlace.place.snapshot?.category === categoryFilter;
      }),
    [activeCollectionId, categoryFilter, savedPlaces],
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
    return savedPlace.place.snapshot?.name ?? savedPlace.place.providerLabel ?? t('providerPlace');
  }

  /**
   * Only provider places ask for a photograph. A custom place is somewhere the
   * traveller invented - a friend's flat, a meeting point - and stock travel
   * photography of its name would be a picture of somewhere else.
   *
   * Capped like the trips library: a saved library has no pagination, so the
   * cap is what keeps one screen to one request. Past it the branded fallback
   * takes over, and narrowing to a collection or category re-asks for whatever
   * is in the first cap of that view.
   */
  const editorialSubjects: EditorialSubject[] = visibleSavedPlaces
    .filter((savedPlace) => savedPlace.place.kind === 'provider')
    .map((savedPlace) => ({
      category: savedPlace.place.snapshot?.category,
      name: getPlaceName(savedPlace),
      placeId: savedPlace.place.id,
    }))
    .slice(0, MAX_EDITORIAL_IMAGE_SUBJECTS);
  const editorialImages = useEditorialImages(editorialSubjects);

  function getPlaceDescription(savedPlace: SavedPlace) {
    if (savedPlace.place.kind === 'custom') {
      return savedPlace.place.note ?? t('customPlaceDescription');
    }

    return (
      savedPlace.place.snapshot?.address ??
      savedPlace.place.providerAddress ??
      t('providerDetailsUnavailable')
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
      const { place } = await resolveProviderPlace(suggestion.externalPlaceId, undefined, locale);
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

  async function handleUnsave() {
    if (!savedPlaceToUnsave) return;
    const savedPlace = savedPlaceToUnsave;
    setUnsavingPlaceId(savedPlace.id);
    setUnsaveError(null);

    try {
      await unsavePlace(savedPlace.id);
      const nextState = removeSavedPlaceState({ collections, savedPlace, savedPlaces });
      setSavedPlaces(nextState.savedPlaces);
      setCollections(nextState.collections);
      if (collectionPickerPlace?.id === savedPlace.id) setCollectionPickerPlace(null);
      setSavedPlaceToUnsave(null);
    } catch (errorValue) {
      setUnsaveError(getErrorMessage(errorValue));
    } finally {
      setUnsavingPlaceId(null);
    }
  }

  function openCollectionEditor(
    mode: CollectionEditor['mode'],
    collection: SavedCollection | null = null,
    createTarget: SavedPlace | null = null,
  ) {
    if (mode === 'closed') {
      setCollectionEditor({ collection: null, mode: 'closed' });
      setCollectionCreateTarget(null);
      return;
    }
    setCollectionError(null);
    setCollectionCreateTarget(mode === 'create' ? createTarget : null);
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

        if (collectionCreateTarget) {
          try {
            await addToCollection(collectionCreateTarget.id, collection.id);
          } catch (errorValue) {
            setCollectionError(getErrorMessage(errorValue));
            setCollectionPickerPlace(collectionCreateTarget);
            openCollectionEditor('closed');
            return;
          }

          const nextState = updateCollectionMembershipState({
            collection,
            collections: [...collections, collection],
            isMember: true,
            savedPlace: collectionCreateTarget,
            savedPlaces,
          });
          setCollections(sortCollections(nextState.collections));
          setSavedPlaces(nextState.savedPlaces);
          setCollectionPickerPlace(nextState.savedPlace);
        }
      }
      openCollectionEditor('closed');
    } catch (errorValue) {
      setCollectionError(getErrorMessage(errorValue));
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
    setCollectionError(null);

    try {
      if (isMember) {
        await removeFromCollection(savedPlace.id, collection.id);
      } else {
        await addToCollection(savedPlace.id, collection.id);
      }

      const nextState = updateCollectionMembershipState({
        collection,
        collections,
        isMember: !isMember,
        savedPlace,
        savedPlaces,
      });
      setCollectionPickerPlace(nextState.savedPlace);
      setSavedPlaces(nextState.savedPlaces);
      setCollections(nextState.collections);
    } catch (errorValue) {
      setCollectionError(getErrorMessage(errorValue));
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
        <PageState headingLevel={2} kind="loading" loadingShape="list" title={t('loading')} />
      ) : status === 'error' ? (
        <PageState
          actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
          description={t('loadErrorDescription')}
          headingLevel={2}
          icon={<CircleAlert aria-hidden="true" />}
          kind="error"
          title={t('loadError')}
        />
      ) : savedPlaces.length === 0 ? (
        // Collections and category filters are inert with nothing to filter yet,
        // so the first screen offers exactly one thing to do: save a place.
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
            <ChipGroup
              aria-label={t('collectionsTitle')}
              className="-mx-1 flex-nowrap overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:flex-wrap lg:overflow-visible lg:px-0"
              multiple={false}
              onValueChange={([value]) =>
                setActiveCollectionId(
                  value === undefined || value === ALL_COLLECTIONS_VALUE ? null : value,
                )
              }
              value={[activeCollectionId ?? ALL_COLLECTIONS_VALUE]}
            >
              <Chip count={savedPlaces.length} value={ALL_COLLECTIONS_VALUE}>
                {t('allSaved')}
              </Chip>
              {collections.map((collection) => (
                <div className="flex min-w-max items-center gap-0.5 lg:min-w-0" key={collection.id}>
                  <Chip count={collection.placeCount} value={collection.id}>
                    {collection.name}
                  </Chip>
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
            </ChipGroup>
          </aside>

          <EditorialSection
            actions={
              <ChipGroup
                className="-mx-1 flex-nowrap overflow-x-auto px-1 pb-1 sm:mx-0 sm:max-w-[32rem] sm:px-0"
                multiple={false}
                onValueChange={([value]) => setCategoryFilter((value ?? 'all') as CategoryFilter)}
                value={[categoryFilter]}
              >
                {categoryFilters.map((filter) => (
                  <Chip key={filter} value={filter}>
                    {t(`categories.${filter}`)}
                  </Chip>
                ))}
              </ChipGroup>
            }
            className="min-w-0"
            description={t('placeCount', { count: visibleSavedPlaces.length })}
            title={activeCollection?.name ?? t('allSaved')}
          >
            {visibleSavedPlaces.length === 0 ? (
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
                  const category = savedPlace.place.snapshot?.category;
                  const editorial =
                    savedPlace.place.kind === 'provider'
                      ? editorialImages.get(
                          editorialSubjectKey({ category, name: getPlaceName(savedPlace) }),
                        )
                      : null;
                  return (
                    <Item
                      className="min-h-20 flex-nowrap px-3 py-3 text-left hover:bg-muted/60"
                      key={savedPlace.id}
                      variant="default"
                    >
                      {savedPlace.place.kind === 'custom' ? (
                        <ItemMedia
                          className="size-14 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground sm:size-16"
                          variant="icon"
                        >
                          <NotebookPen aria-hidden="true" className="size-5" />
                        </ItemMedia>
                      ) : (
                        <ItemMedia
                          className="size-14 rounded-[var(--radius-md)] sm:size-16"
                          variant="default"
                        >
                          <PlaceMedia
                            alt={
                              editorial
                                ? mediaTranslations('alt.placeEditorial', {
                                    name: getPlaceName(savedPlace),
                                  })
                                : ''
                            }
                            category={category}
                            className="size-full"
                            // A thumbnail this size cannot carry a legible
                            // credit, so the row renders it below instead.
                            credit="inline"
                            sizes="64px"
                            source={resolvePlaceMediaSource({ editorial })}
                            variant="thumbnail"
                          />
                        </ItemMedia>
                      )}
                      <ItemContent className="min-w-0 gap-1.5">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <ItemTitle className="max-w-full text-base">
                            {getPlaceName(savedPlace)}
                          </ItemTitle>
                          {category ? (
                            <Badge size="sm" variant="muted">
                              {t(`categories.${category}`)}
                            </Badge>
                          ) : null}
                        </div>
                        <ItemDescription className="line-clamp-1">
                          {getPlaceDescription(savedPlace)}
                        </ItemDescription>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-subtle">
                          <span>
                            {t('savedOn', {
                              date: dateFormatter.format(new Date(savedPlace.createdAt)),
                            })}
                          </span>
                          {savedPlace.collections.length ? (
                            <span className="inline-flex min-w-0 items-center gap-1">
                              <FolderPlus aria-hidden="true" className="size-3 shrink-0" />
                              <span className="truncate">
                                {savedPlace.collections
                                  .map((collection) => collection.name)
                                  .join(', ')}
                              </span>
                            </span>
                          ) : null}
                        </div>
                        {savedPlace.note ? (
                          <p className="flex items-start gap-1.5 text-xs leading-5 text-text-subtle">
                            <StickyNote aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                            <span className="line-clamp-2">{savedPlace.note}</span>
                          </p>
                        ) : null}
                        {editorial ? (
                          <MediaAttribution attribution={editorial.attribution} variant="inline" />
                        ) : null}
                      </ItemContent>
                      <ItemActions className="shrink-0 self-start">
                        {googleMapsPlaceHref(savedPlace.place) ? (
                          <Button
                            aria-label={t('viewDetails', { name: getPlaceName(savedPlace) })}
                            nativeButton={false}
                            render={
                              <a
                                href={googleMapsPlaceHref(savedPlace.place)!}
                                rel="noreferrer"
                                target="_blank"
                              />
                            }
                            size="sm"
                            variant="ghost"
                          >
                            <Eye aria-hidden="true" />
                            <span className="hidden sm:inline">{t('viewDetailsAction')}</span>
                          </Button>
                        ) : null}
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                aria-label={t('moreActions', {
                                  name: getPlaceName(savedPlace),
                                })}
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                              />
                            }
                          >
                            <Ellipsis aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem
                              onClick={() => {
                                setCollectionError(null);
                                setCollectionPickerPlace(savedPlace);
                              }}
                            >
                              <FolderPlus aria-hidden="true" />
                              {t('manageCollectionsAction')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openNoteEditor(savedPlace)}>
                              <Pencil aria-hidden="true" />
                              {t('editNoteAction')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={unsavingPlaceId === savedPlace.id}
                              onClick={() => {
                                setUnsaveError(null);
                                setSavedPlaceToUnsave(savedPlace);
                              }}
                              variant="destructive"
                            >
                              <Trash2 aria-hidden="true" />
                              {t('removeFromSaved')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </ItemActions>
                    </Item>
                  );
                })}
              </ItemGroup>
            )}
          </EditorialSection>
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
          className="w-full md:data-[side=right]:w-[min(34rem,calc(100%-0.5rem))]"
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
            {collectionError ? (
              <Alert className="mt-5" role="alert" variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{collectionError}</AlertDescription>
              </Alert>
            ) : null}
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
          {collectionError ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{collectionError}</AlertDescription>
            </Alert>
          ) : null}
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
                    disabled={Boolean(togglingCollectionId)}
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
                const target = collectionPickerPlace;
                setCollectionPickerPlace(null);
                openCollectionEditor('create', null, target);
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

      <AlertDialog
        open={Boolean(savedPlaceToUnsave)}
        onOpenChange={(open) => {
          if (!open && !unsavingPlaceId) {
            setSavedPlaceToUnsave(null);
            setUnsaveError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unsaveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('unsaveDescription', {
                name: savedPlaceToUnsave ? getPlaceName(savedPlaceToUnsave) : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {unsaveError ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{unsaveError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(unsavingPlaceId)}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(unsavingPlaceId)}
              onClick={() => void handleUnsave()}
              variant="destructive"
            >
              {unsavingPlaceId ? t('removingFromSaved') : t('removeFromSaved')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
