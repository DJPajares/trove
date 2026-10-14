'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CircleAlert,
  Ellipsis,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { BackLink } from '@/components/back-link';
import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { PlaceDetailsSheet, type PlaceDetailsRow } from '@/components/place-details-sheet';
import { BrandedFallback } from '@/components/media-frame';
import { PlaceMedia } from '@/components/place-media';
import { useRegisterPrimaryAction } from '@/components/primary-action-provider';
import { AddSavedToTripSheet } from '@/components/saved/add-saved-to-trip-sheet';
import { CollectionPlacesSheet } from '@/components/saved/collection-places-sheet';
import { SavedReadyForTrip } from '@/components/saved/saved-ready-for-trip';
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
import { Chip, ChipGroup } from '@/components/ui/chip';
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
import { Sheet, SheetContent, SheetFooter, SheetHeading } from '@/components/ui/sheet';
import {
  addToCollection,
  createCollection,
  createCustomPlace,
  fetchSavedPlaces,
  type SavedPlacesResponse,
  removeCollection,
  removeFromCollection,
  renameCollection,
  resolveProviderPlace,
  saveCanonicalPlace,
  SavedApiError,
  type ProviderSuggestion,
  type SavedCollection,
  type SavedPlace,
  unsavePlace,
  updateSavedPlaceNote,
} from '@/lib/saved/api';
import { PROVIDER_SEARCH_RESULT_LIMIT } from '@/lib/saved/search-results';
import { useEditorialImageResolution, useEditorialImages } from '@/hooks/use-editorial-images';
import { useProviderPlaceSearch } from '@/hooks/use-provider-place-search';
import {
  editorialSubjectKey,
  MAX_EDITORIAL_IMAGE_SUBJECTS,
  primaryEditorialImage,
  type EditorialSubject,
} from '@/lib/media/editorial-images';
import { resolvePlaceMediaSource } from '@/lib/media/trip-media';
import {
  removeSavedPlaceState,
  updateCollectionMembershipState,
} from '@/lib/saved/collection-membership';
import { queryKeys } from '@/lib/query/keys';
import {
  collectionCoverTiles,
  coverRequestOrder,
  rediscoverSaved,
} from '@/lib/saved/collection-view';
import { matchesPlaceQuery } from '@/lib/trip-places/list-view';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

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

function sortCollections(collections: SavedCollection[]) {
  return collections.toSorted((left, right) => left.name.localeCompare(right.name));
}

const EMPTY_SAVED_PLACES: SavedPlace[] = [];
/** Up to this many, Saved shows big cards and leaves sorting tools out until there is enough to sort. */
const SMALL_COLLECTION = 4;
const REDISCOVER_KEPT_STORAGE_KEY = 'trove:saved-rediscover-kept:v1';
const EMPTY_COLLECTIONS: SavedCollection[] = [];
const subscribeNothing = () => () => {};

/**
 * Saved, or one collection of it. With `collectionId` the same library opens on
 * that collection as its own page: its heading, its places, and its options,
 * with every place action and sheet shared with Saved itself.
 */
export function SavedPlacesManager({
  collectionId = null,
}: Readonly<{ collectionId?: string | null }> = {}) {
  const t = useTranslations('saved');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const savedQuery = useQuery({ queryFn: fetchSavedPlaces, queryKey: queryKeys.savedPlaces() });
  // Saved is restored from this device's cache, which can land before this
  // page hydrates. The server never has it, so the first client pass renders
  // without it too - headings included - and the cached library follows a
  // frame later instead of failing hydration.
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const savedData = hydrated ? savedQuery.data : undefined;
  const savedPlaces = savedData?.savedPlaces ?? EMPTY_SAVED_PLACES;
  const collections = savedData?.collections ?? EMPTY_COLLECTIONS;

  /**
   * Writes straight into the shared cache while keeping the setState signature
   * this screen's optimistic updates are written against. Saving a Place from
   * the itinerary's add sheet and saving one here are the same collection, so
   * both surfaces move together rather than each holding a copy.
   */
  const writeSaved = useCallback(
    <Key extends 'collections' | 'savedPlaces'>(
      field: Key,
      next:
        | SavedPlacesResponse[Key]
        | ((current: SavedPlacesResponse[Key]) => SavedPlacesResponse[Key]),
    ) => {
      queryClient.setQueryData(
        queryKeys.savedPlaces(),
        (current: SavedPlacesResponse | undefined) =>
          current
            ? {
                ...current,
                [field]:
                  typeof next === 'function'
                    ? (next as (value: SavedPlacesResponse[Key]) => SavedPlacesResponse[Key])(
                        current[field],
                      )
                    : next,
              }
            : current,
      );
    },
    [queryClient],
  );

  const setSavedPlaces = useCallback(
    (next: SavedPlace[] | ((current: SavedPlace[]) => SavedPlace[])) =>
      writeSaved('savedPlaces', next),
    [writeSaved],
  );
  const setCollections = useCallback(
    (next: SavedCollection[] | ((current: SavedCollection[]) => SavedCollection[])) =>
      writeSaved('collections', next),
    [writeSaved],
  );
  const router = useRouter();
  const activeCollectionId = collectionId;
  const collectionMode = collectionId !== null;
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const status =
    !hydrated || savedQuery.isPending ? 'loading' : savedQuery.error ? 'error' : 'idle';
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<'custom' | 'search'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  // Searches while the add sheet is open are billed as one Autocomplete session.
  const search = useProviderPlaceSearch(searchQuery, null);
  const searchResults = search.results.slice(0, PROVIDER_SEARCH_RESULT_LIMIT);
  const searchStatus = search.status;
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
  const [placesSheetOpen, setPlacesSheetOpen] = useState(false);
  const [noteEditorPlace, setNoteEditorPlace] = useState<SavedPlace | null>(null);
  const [noteValue, setNoteValue] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [savedPlaceToUnsave, setSavedPlaceToUnsave] = useState<SavedPlace | null>(null);
  const [unsaveError, setUnsaveError] = useState<string | null>(null);
  const [unsavingPlaceId, setUnsavingPlaceId] = useState<string | null>(null);
  const [detailsPlace, setDetailsPlace] = useState<SavedPlace | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    await queryClient.invalidateQueries({ queryKey: queryKeys.savedPlaces() });
  }, [queryClient]);

  // A collection just made arrives with `?add=1`: it opens on choosing its
  // places, once, and the address goes back to the collection's own.
  useEffect(() => {
    if (!collectionMode) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('add') !== '1') return;
    setPlacesSheetOpen(true);
    url.searchParams.delete('add');
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [collectionMode, router]);

  // In the library there is one thing worth making, and the header button and
  // the bottom bar's create button now open the same sheet to make it. Its
  // form resets on close, so arriving from either is the same fresh start.
  useRegisterPrimaryAction({
    enabled: true,
    label: t('addPlace'),
    onTrigger: () => setAddOpen(true),
  });

  const activeCollection =
    collections.find((collection) => collection.id === activeCollectionId) ?? null;
  const [query, setQuery] = useState('');
  const [tripTarget, setTripTarget] = useState<SavedPlace | null>(null);
  // How many places this page is about: all of Saved, or one collection's.
  const scopeCount = activeCollectionId
    ? savedPlaces.filter((savedPlace) =>
        savedPlace.collections.some((collection) => collection.id === activeCollectionId),
      ).length
    : savedPlaces.length;
  // Newest first: a collection is browsed for what was kept lately, and the
  // rediscover card is what brings the oldest back.
  const visibleSavedPlaces = useMemo(
    () =>
      savedPlaces
        .filter((savedPlace) => {
          const belongsToActiveCollection =
            !activeCollectionId ||
            savedPlace.collections.some((collection) => collection.id === activeCollectionId);
          if (!belongsToActiveCollection) return false;
          if (categoryFilter !== 'all' && savedPlace.place.snapshot?.category !== categoryFilter)
            return false;
          return matchesPlaceQuery(
            [
              savedPlace.place.name,
              savedPlace.place.snapshot?.name,
              savedPlace.place.providerLabel,
              savedPlace.place.snapshot?.address,
              savedPlace.place.providerAddress,
              savedPlace.place.note,
              savedPlace.note,
              ...savedPlace.collections.map((collection) => collection.name),
            ],
            query,
          );
        })
        .toSorted(
          (left, right) =>
            // A small collection leads with a place that has a picture, so its
            // one big card is never a blank personal place.
            (scopeCount <= SMALL_COLLECTION
              ? Number(right.place.kind === 'provider') - Number(left.place.kind === 'provider')
              : 0) || right.createdAt.localeCompare(left.createdAt),
        ),
    [activeCollectionId, categoryFilter, query, savedPlaces, scopeCount],
  );

  // Which long-saved places the traveller has said to keep. Remembered on this
  // device only: it is a reading convenience, not part of the collection.
  const [keptOld, setKeptOld] = useState<ReadonlySet<string>>(new Set());
  const [now] = useState(() => Date.now());
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(
        window.localStorage.getItem(REDISCOVER_KEPT_STORAGE_KEY) ?? '[]',
      );
      if (Array.isArray(stored)) setKeptOld(new Set(stored.filter((id) => typeof id === 'string')));
    } catch {
      // Without storage the card simply asks again next time.
    }
  }, []);
  function keepRediscovered(id: string) {
    const next = new Set([...keptOld, id]);
    setKeptOld(next);
    try {
      window.localStorage.setItem(REDISCOVER_KEPT_STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // Kept for this visit even when it cannot be remembered.
    }
  }
  const rediscover =
    savedPlaces.length > SMALL_COLLECTION ? rediscoverSaved(savedPlaces, now, keptOld) : null;
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
    [locale],
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
  const editorialSubject = (savedPlace: SavedPlace): EditorialSubject => ({
    category: savedPlace.place.snapshot?.category,
    name: getPlaceName(savedPlace),
    placeId: savedPlace.place.id,
  });
  const editorialSubjects: EditorialSubject[] = visibleSavedPlaces
    .filter((savedPlace) => savedPlace.place.kind === 'provider')
    .map(editorialSubject)
    .slice(0, MAX_EDITORIAL_IMAGE_SUBJECTS);
  const editorialImages = useEditorialImages(editorialSubjects);

  // Covers ask separately, so however many collections there are, the grid's
  // own photos are never pushed past its cap. Every cover's lead photo is asked
  // for before any cover's smaller tiles.
  const coverTiles = new Map(
    (collectionMode ? [] : collections).map((collection) => [
      collection.id,
      collectionCoverTiles(collection.id, savedPlaces),
    ]),
  );
  const coverImages = useEditorialImageResolution(
    coverRequestOrder([...coverTiles.values()])
      .filter((savedPlace) => savedPlace.place.kind === 'provider')
      .map(editorialSubject)
      .slice(0, MAX_EDITORIAL_IMAGE_SUBJECTS),
  );
  function getCoverImage(savedPlace: SavedPlace) {
    return (
      primaryEditorialImage(
        coverImages.images.get(editorialSubjectKey(editorialSubject(savedPlace))),
      ) ?? getEditorialImage(savedPlace)
    );
  }

  /** The ordered collection resolved for a place by the one batch above. */
  function getEditorialImages(savedPlace: SavedPlace) {
    if (savedPlace.place.kind !== 'provider') return [];
    return (
      editorialImages.get(
        editorialSubjectKey({
          category: savedPlace.place.snapshot?.category,
          name: getPlaceName(savedPlace),
          placeId: savedPlace.place.id,
        }),
      ) ?? []
    );
  }

  const getEditorialImage = (savedPlace: SavedPlace) => getEditorialImages(savedPlace)[0] ?? null;

  /** What the details sheet cannot know: how this place sits in the library. */
  function getDetailsMeta(savedPlace: SavedPlace): PlaceDetailsRow[] {
    return [
      { label: t('savedOnLabel'), value: dateFormatter.format(new Date(savedPlace.createdAt)) },
      savedPlace.collections.length
        ? {
            label: t('collectionsLabel'),
            value: savedPlace.collections.map((collection) => collection.name).join(', '),
          }
        : null,
      savedPlace.note ? { label: t('personalNote'), value: savedPlace.note } : null,
    ].filter((row): row is PlaceDetailsRow => row !== null);
  }

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
    search.endSession();
  }

  /**
   * Puts a newly saved place where the traveller is looking: at the top of
   * Saved, and - when this page is a collection - into that collection too, so
   * a place added here appears here.
   */
  async function keepNewlySaved(savedPlace: SavedPlace) {
    const nextPlaces = [savedPlace, ...savedPlaces.filter((item) => item.id !== savedPlace.id)];
    if (
      !activeCollection ||
      savedPlace.collections.some((item) => item.id === activeCollection.id)
    ) {
      setSavedPlaces(nextPlaces);
      return;
    }
    try {
      await addToCollection(savedPlace.id, activeCollection.id);
    } catch (errorValue) {
      // Saved either way; only joining this collection failed.
      setSavedPlaces(nextPlaces);
      throw errorValue;
    }
    const nextState = updateCollectionMembershipState({
      collection: activeCollection,
      collections,
      isMember: true,
      savedPlace,
      savedPlaces: nextPlaces,
    });
    setSavedPlaces(nextState.savedPlaces);
    setCollections(nextState.collections);
  }

  async function handleProviderSave(suggestion: ProviderSuggestion) {
    setSavingProviderId(suggestion.externalPlaceId);
    setError(null);

    try {
      const { place } = await resolveProviderPlace(
        suggestion.externalPlaceId,
        undefined,
        locale,
        search.sessionToken(),
        'saved',
      );
      const { savedPlace } = await saveCanonicalPlace(place.id);
      setAddOpen(false);
      resetAddForm();
      await keepNewlySaved(savedPlace);
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
      setAddOpen(false);
      resetAddForm();
      await keepNewlySaved(savedPlace);
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
        } else {
          // A collection made on its own is empty, so it opens straight onto
          // choosing what goes in it.
          openCollectionEditor('closed');
          router.push(`/saved/collections/${collection.id}?add=1`);
          return;
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
      // The page being stood on is gone, so it leaves the back stack too.
      if (activeCollectionId === collectionToDelete.id) router.replace('/saved');
      setCollectionToDelete(null);
    } catch (errorValue) {
      setError(getErrorMessage(errorValue));
    }
  }

  /** Adds a place to a collection or takes it out, from either sheet that offers it. */
  async function toggleCollectionMembership(savedPlace: SavedPlace, collection: SavedCollection) {
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
      if (collectionPickerPlace?.id === savedPlace.id) {
        setCollectionPickerPlace(nextState.savedPlace);
      }
      setSavedPlaces(nextState.savedPlaces);
      setCollections(nextState.collections);
    } catch (errorValue) {
      setCollectionError(getErrorMessage(errorValue));
    } finally {
      setTogglingCollectionId(null);
    }
  }

  function openPlacesSheet() {
    setCollectionError(null);
    setPlacesSheetOpen(true);
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

  // The places this page is about: all of Saved, or one collection's members.
  const scopePlaces = activeCollectionId
    ? savedPlaces.filter((savedPlace) =>
        savedPlace.collections.some((collection) => collection.id === activeCollectionId),
      )
    : savedPlaces;
  const small = scopePlaces.length <= SMALL_COLLECTION;
  const filtering = Boolean(query.trim()) || categoryFilter !== 'all';
  // Only categories something here belongs to; a chip that empties the grid helps no one.
  const presentCategoryFilters = categoryFilters.filter(
    (filter) =>
      filter === 'all' ||
      scopePlaces.some((savedPlace) => savedPlace.place.snapshot?.category === filter),
  );

  /** One tile of a collection's cover: the place's photo, held calm until it settles. */
  const coverTile = (savedPlace: SavedPlace, sizes: string) =>
    savedPlace.place.kind === 'provider' ? (
      <PlaceMedia
        alt=""
        category={savedPlace.place.snapshot?.category}
        className="size-full rounded-none"
        isResolving={!coverImages.isResolved && !getCoverImage(savedPlace)}
        loadingTreatment="calm"
        sizes={sizes}
        source={resolvePlaceMediaSource({ editorial: getCoverImage(savedPlace) })}
        variant="thumbnail"
      />
    ) : (
      <BrandedFallback alt="" category={savedPlace.place.snapshot?.category ?? 'other'} />
    );

  const card = (savedPlace: SavedPlace, featured = false) => {
    const name = getPlaceName(savedPlace);
    const category = savedPlace.place.snapshot?.category;
    const editorial = getEditorialImage(savedPlace);
    return (
      <article
        className={cn('group relative flex min-w-0 flex-col gap-2', featured && 'col-span-2')}
        key={savedPlace.id}
      >
        <div className="relative overflow-hidden rounded-[var(--radius-xl)]">
          {savedPlace.place.kind === 'custom' ? (
            <div
              className={cn(
                'grid place-items-center border border-dashed border-border-strong bg-muted text-muted-foreground',
                featured ? 'aspect-[16/9]' : 'aspect-[4/3]',
              )}
            >
              <Icons.CustomPlace aria-hidden="true" className="size-7" />
            </div>
          ) : (
            <PlaceMedia
              alt={editorial ? mediaTranslations('alt.placeEditorial', { name }) : ''}
              category={category}
              className={cn('rounded-none', featured ? 'aspect-[16/9]' : 'aspect-[4/3]')}
              sizes={featured ? '(min-width: 768px) 50vw, 100vw' : '(min-width: 768px) 25vw, 50vw'}
              source={resolvePlaceMediaSource({ editorial })}
              variant="card"
            />
          )}
          <div className="absolute top-2 right-2 z-10">{placeMenu(savedPlace)}</div>
        </div>
        <div className="min-w-0 px-0.5">
          <h3 className="font-journal text-[1.25rem] leading-[1.1] font-normal text-balance [overflow-wrap:anywhere]">
            {/* The name opens the place and stretches over the card, while the
                menu above it stays reachable. */}
            <button
              aria-label={t('viewDetails', { name })}
              className="text-left outline-none after:absolute after:inset-0 after:rounded-[var(--radius-xl)] focus-visible:after:ring-3 focus-visible:after:ring-ring/40"
              onClick={() => setDetailsPlace(savedPlace)}
              type="button"
            >
              {name}
            </button>
          </h3>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {savedPlace.note
              ? `“${savedPlace.note}”`
              : savedPlace.place.kind === 'custom'
                ? t('yourPlace')
                : category
                  ? t(`categories.${category}`)
                  : getPlaceDescription(savedPlace)}
          </p>
        </div>
      </article>
    );
  };

  function placeMenu(savedPlace: SavedPlace) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t('moreActions', { name: getPlaceName(savedPlace) })}
              className="rounded-full bg-score-media-background/75 text-score-media-foreground backdrop-blur-sm hover:bg-score-media-background hover:text-score-media-foreground"
              size="icon-sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => setTripTarget(savedPlace)}>
            <Plus aria-hidden="true" />
            {t('addToTripAction')}
          </DropdownMenuItem>
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
    );
  }

  return (
    <section className="mx-auto w-full max-w-6xl space-y-8">
      {collectionMode ? (
        <div>
          <BackLink href="/saved" label={t('backToSaved')} />
          <PageHeader
            actions={
              activeCollection ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    aria-haspopup="dialog"
                    className="rounded-full"
                    onClick={() => openPlacesSheet()}
                    size="sm"
                    type="button"
                  >
                    <Plus aria-hidden="true" data-icon="inline-start" />
                    {t('addPlacesAction')}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          className="rounded-full"
                          size="sm"
                          type="button"
                          variant="outline"
                        />
                      }
                    >
                      <Pencil aria-hidden="true" data-icon="inline-start" />
                      {t('editCollectionAction')}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem
                        onClick={() => openCollectionEditor('rename', activeCollection)}
                      >
                        <Pencil aria-hidden="true" />
                        {t('renameCollectionTitle')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setCollectionToDelete(activeCollection)}
                        variant="destructive"
                      >
                        <Trash2 aria-hidden="true" />
                        {t('deleteCollection')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : undefined
            }
            description={
              activeCollection ? t('placeCount', { count: scopePlaces.length }) : undefined
            }
            eyebrow={t('collectionEyebrow')}
            title={activeCollection?.name ?? t('collectionEyebrow')}
            titleFont="journal"
          />
        </div>
      ) : (
        <PageHeader
          actions={
            // A phone already adds a place from the + at the centre of its bottom bar.
            <Button className="max-md:hidden" onClick={() => setAddOpen(true)}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addPlace')}
            </Button>
          }
          description={t('description')}
          eyebrow={t('eyebrow')}
          title={t('title')}
          titleFont="journal"
        />
      )}

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
      ) : collectionMode && !activeCollection ? (
        <PageState
          actions={
            <Button nativeButton={false} render={<Link href="/saved" />} variant="outline">
              {t('backToSavedAction')}
            </Button>
          }
          description={t('collectionNotFoundDescription')}
          headingLevel={2}
          icon={<Icons.Saved aria-hidden="true" />}
          kind="empty"
          title={t('collectionNotFoundTitle')}
        />
      ) : collectionMode && activeCollection && scopePlaces.length === 0 ? (
        <PageState
          actions={
            <>
              <Button aria-haspopup="dialog" onClick={() => openPlacesSheet()}>
                <Plus aria-hidden="true" data-icon="inline-start" />
                {t('addPlacesAction')}
              </Button>
              <Button nativeButton={false} render={<Link href="/saved" />} variant="outline">
                {t('backToSavedAction')}
              </Button>
            </>
          }
          description={t('collectionEmptyAddDescription')}
          headingLevel={2}
          icon={<FolderPlus aria-hidden="true" />}
          kind="empty"
          title={t('collectionEmptyTitle', { name: activeCollection.name })}
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
          icon={<Icons.Saved aria-hidden="true" />}
          kind="empty"
          title={t('emptyTitle')}
        />
      ) : (
        <>
          {small ? null : (
            <SearchField
              label={t('findLabel')}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('findPlaceholder')}
              value={query}
              wrapperClassName="max-w-xl"
            />
          )}

          {collectionMode ? null : (
            <section aria-labelledby="saved-collections" className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2
                  className="flex items-baseline gap-2 text-lg font-semibold"
                  id="saved-collections"
                >
                  {t('collectionsTitle')}
                  {collections.length ? (
                    <span className="text-sm font-normal text-muted-foreground tabular-nums">
                      {collections.length}
                    </span>
                  ) : null}
                </h2>
                {collections.length ? (
                  <Button
                    className="rounded-full"
                    onClick={() => openCollectionEditor('create')}
                    size="sm"
                    variant="outline"
                  >
                    <FolderPlus aria-hidden="true" data-icon="inline-start" />
                    {t('newCollection')}
                  </Button>
                ) : null}
              </div>
              {collections.length ? (
                <div className="-mx-[var(--gutter-inline-start)] flex snap-x scroll-px-[var(--gutter-inline-start)] gap-3 overflow-x-auto px-[var(--gutter-inline-start)] pb-1 [scrollbar-width:none]">
                  {collections.map((collection) => {
                    const tiles = coverTiles.get(collection.id) ?? [];
                    return (
                      // A collection opens as its own page rather than filtering
                      // the grid below: it is a place to return to, with an
                      // address. Focus draws inside the cover so the scroller
                      // never clips it.
                      <Link
                        className="group/collection flex w-40 shrink-0 snap-start flex-col gap-2 text-left outline-none"
                        href={`/saved/collections/${collection.id}`}
                        key={collection.id}
                      >
                        {/* The layout follows how many places can show a photo,
                          which is known before any photo loads, so the cover
                          never rearranges itself as they arrive. */}
                        <span
                          className={cn(
                            'relative grid aspect-[4/5] w-full gap-0.5 overflow-hidden rounded-[var(--radius-xl)] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:transition-shadow after:duration-[var(--motion-standard)] group-hover/collection:after:shadow-[inset_0_0_0_2px_var(--color-border-strong)] group-focus-visible/collection:after:shadow-[inset_0_0_0_3px_var(--color-ring)]',
                            tiles.length > 1 && 'grid-cols-2 grid-rows-[2fr_1fr]',
                          )}
                        >
                          {tiles.length ? (
                            tiles.map((tile, index) => (
                              <span
                                className={cn(
                                  'relative min-h-0',
                                  tiles.length > 1 &&
                                    (index === 0 || tiles.length === 2) &&
                                    'col-span-2',
                                )}
                                key={tile.id}
                              >
                                {coverTile(tile, index === 0 ? '160px' : '80px')}
                              </span>
                            ))
                          ) : (
                            <BrandedFallback alt="" />
                          )}
                        </span>
                        <span>
                          <span className="block font-journal text-[1.375rem] leading-[1.05] font-normal">
                            {collection.name}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {t('placeCount', { count: collection.placeCount })}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                // Before the first collection, the section explains itself once
                // and offers the one thing to do, rather than an empty row.
                <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-5 sm:flex-nowrap">
                  <span
                    aria-hidden="true"
                    className="grid size-12 shrink-0 place-items-center rounded-[var(--radius-lg)] bg-surface-tint text-brand"
                  >
                    <FolderPlus className="size-6" />
                  </span>
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="font-journal text-[1.375rem] leading-[1.15] font-normal">
                      {t('collectionsIntroTitle')}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {t('collectionsIntroDescription')}
                    </p>
                  </div>
                  <Button className="rounded-full" onClick={() => openCollectionEditor('create')}>
                    <FolderPlus aria-hidden="true" data-icon="inline-start" />
                    {t('createFirstCollection')}
                  </Button>
                </div>
              )}
            </section>
          )}

          {collectionMode ? null : <SavedReadyForTrip nameOf={getPlaceName} saved={savedPlaces} />}

          <section
            aria-label={collectionMode ? activeCollection?.name : undefined}
            aria-labelledby={collectionMode ? undefined : 'saved-everything'}
            className="space-y-4"
          >
            {collectionMode ? null : (
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2
                  className="font-journal text-[2rem] leading-[1] font-normal"
                  id="saved-everything"
                >
                  {t('everything')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('placeCount', { count: visibleSavedPlaces.length })}
                </p>
              </div>
            )}
            {small ? null : (
              <ChipGroup
                className="interaction-scrollbar -mx-1 flex-nowrap overflow-x-auto px-1 pb-1"
                multiple={false}
                onValueChange={([value]) => setCategoryFilter((value ?? 'all') as CategoryFilter)}
                value={[categoryFilter]}
              >
                {presentCategoryFilters.map((filter) => (
                  <Chip key={filter} value={filter}>
                    {t(`categories.${filter}`)}
                  </Chip>
                ))}
              </ChipGroup>
            )}

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
              <div
                aria-label={t('listLabel')}
                className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4"
                role="list"
              >
                {visibleSavedPlaces.map((savedPlace, index) => (
                  <div
                    className={cn('min-w-0', small && !filtering && index === 0 && 'col-span-2')}
                    key={savedPlace.id}
                    role="listitem"
                  >
                    {card(savedPlace, small && !filtering && index === 0)}
                  </div>
                ))}
              </div>
            )}
          </section>

          {small && !collectionMode ? (
            <section className="space-y-2 rounded-[var(--radius-xl)] border border-status-warning/25 bg-surface-tint p-5">
              <h2 className="font-semibold">{t('growTitle')}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t('growDescription')}
              </p>
            </section>
          ) : null}

          {rediscover && !collectionMode ? (
            <section
              aria-labelledby="saved-rediscover"
              className="flex flex-wrap items-center gap-4 rounded-[var(--radius-xl)] border border-status-warning/25 bg-surface-tint p-5"
            >
              <div className="min-w-0 flex-1 basis-64 space-y-1">
                <h2
                  className="font-journal text-[1.5rem] leading-[1.1] font-normal"
                  id="saved-rediscover"
                >
                  {t('rediscover.title', { name: getPlaceName(rediscover) })}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('rediscover.description', {
                    date: monthFormatter.format(new Date(rediscover.createdAt)),
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="rounded-full"
                  onClick={() => {
                    setUnsaveError(null);
                    setSavedPlaceToUnsave(rediscover);
                  }}
                  variant="outline"
                >
                  {t('rediscover.letGo')}
                </Button>
                <Button className="rounded-full" onClick={() => keepRediscovered(rediscover.id)}>
                  {t('rediscover.keep')}
                </Button>
              </div>
            </section>
          ) : null}
        </>
      )}

      <AddSavedToTripSheet
        name={tripTarget ? getPlaceName(tripTarget) : ''}
        onOpenChange={(open) => !open && setTripTarget(null)}
        savedPlace={tripTarget}
      />

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
          <SheetHeading
            title={t('addPlaceTitle')}
            description={
              activeCollection
                ? t('addPlaceToCollectionDescription', { name: activeCollection.name })
                : t('addPlaceDescription')
            }
          />
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
                {!search.searchable ? (
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
                          <Icons.Places aria-hidden="true" />
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

      <Sheet
        onOpenChange={(open) => {
          if (!open) openCollectionEditor('closed');
        }}
        open={collectionEditor.mode !== 'closed'}
      >
        <SheetContent closeLabel={t('close')}>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => void handleCollectionSave(event)}
          >
            <SheetHeading
              title={
                collectionEditor.mode === 'rename'
                  ? t('renameCollectionTitle')
                  : t('createCollectionTitle')
              }
              description={
                collectionEditor.mode === 'rename'
                  ? t('renameCollectionDescription')
                  : t('createCollectionDescription')
              }
            />
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              {collectionError ? (
                <Alert role="alert" variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription>{collectionError}</AlertDescription>
                </Alert>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="saved-collection-name">{t('collectionName')}</Label>
                <Input
                  autoFocus
                  id="saved-collection-name"
                  onChange={(event) => setCollectionName(event.target.value)}
                  required
                  value={collectionName}
                />
              </div>
            </div>
            <SheetFooter className="flex-col-reverse sm:flex-row sm:justify-end">
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
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

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

      <Sheet
        onOpenChange={(open) => {
          if (!open) setCollectionPickerPlace(null);
        }}
        open={Boolean(collectionPickerPlace)}
      >
        <SheetContent closeLabel={t('close')}>
          <SheetHeading
            title={t('manageCollectionsTitle')}
            description={t('manageCollectionsDescription', {
              name: collectionPickerPlace ? getPlaceName(collectionPickerPlace) : '',
            })}
          />
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            {collectionError ? (
              <Alert role="alert" variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{collectionError}</AlertDescription>
              </Alert>
            ) : null}
            {collections.length ? (
              <div className="space-y-1">
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
                      onClick={() =>
                        collectionPickerPlace
                          ? void toggleCollectionMembership(collectionPickerPlace, collection)
                          : undefined
                      }
                      variant={selected ? 'secondary' : 'ghost'}
                    >
                      <span>{collection.name}</span>
                      {selected ? <Check aria-hidden="true" /> : null}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">{t('noCollections')}</p>
            )}
          </div>
          <SheetFooter className="flex-col-reverse sm:flex-row sm:justify-end">
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
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <CollectionPlacesSheet
        collection={activeCollection}
        error={collectionError}
        nameOf={getPlaceName}
        onOpenChange={setPlacesSheetOpen}
        onToggle={(savedPlace) => {
          if (activeCollection) void toggleCollectionMembership(savedPlace, activeCollection);
        }}
        open={placesSheetOpen}
        savedPlaces={savedPlaces}
        subtitleOf={(savedPlace) => {
          const category = savedPlace.place.snapshot?.category;
          return savedPlace.place.kind === 'custom'
            ? t('yourPlace')
            : category
              ? t(`categories.${category}`)
              : getPlaceDescription(savedPlace);
        }}
        toggling={Boolean(togglingCollectionId)}
      />

      <Sheet
        open={Boolean(noteEditorPlace)}
        onOpenChange={(open) => !open && setNoteEditorPlace(null)}
      >
        <SheetContent closeLabel={t('close')}>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => void handleNoteSave(event)}
          >
            <SheetHeading
              title={t('editNoteTitle')}
              description={t('editNoteDescription', {
                name: noteEditorPlace ? getPlaceName(noteEditorPlace) : '',
              })}
            />
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <div className="space-y-2">
                <Label htmlFor="saved-place-note">{t('personalNote')}</Label>
                <Input
                  autoFocus
                  id="saved-place-note"
                  onChange={(event) => setNoteValue(event.target.value)}
                  placeholder={t('personalNotePlaceholder')}
                  value={noteValue}
                />
              </div>
            </div>
            <SheetFooter className="flex-col-reverse sm:flex-row sm:justify-end">
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
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

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

      {detailsPlace ? (
        <PlaceDetailsSheet
          editorialImages={getEditorialImages(detailsPlace)}
          meta={getDetailsMeta(detailsPlace)}
          name={getPlaceName(detailsPlace)}
          onOpenChange={(open) => !open && setDetailsPlace(null)}
          place={detailsPlace.place}
        />
      ) : null}
    </section>
  );
}
