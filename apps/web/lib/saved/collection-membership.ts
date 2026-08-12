import type { SavedCollection, SavedPlace } from './api';

export function updateCollectionMembershipState(input: {
  collection: SavedCollection;
  collections: SavedCollection[];
  isMember: boolean;
  savedPlace: SavedPlace;
  savedPlaces: SavedPlace[];
}) {
  const wasMember = input.savedPlace.collections.some(
    (collection) => collection.id === input.collection.id,
  );
  if (wasMember === input.isMember) {
    return {
      collections: input.collections,
      savedPlace: input.savedPlace,
      savedPlaces: input.savedPlaces,
    };
  }

  const nextSavedPlace = {
    ...input.savedPlace,
    collections: input.isMember
      ? [...input.savedPlace.collections, { id: input.collection.id, name: input.collection.name }]
      : input.savedPlace.collections.filter((collection) => collection.id !== input.collection.id),
  };

  return {
    collections: input.collections.map((collection) =>
      collection.id === input.collection.id
        ? {
            ...collection,
            placeCount: Math.max(0, collection.placeCount + (input.isMember ? 1 : -1)),
          }
        : collection,
    ),
    savedPlace: nextSavedPlace,
    savedPlaces: input.savedPlaces.map((savedPlace) =>
      savedPlace.id === nextSavedPlace.id ? nextSavedPlace : savedPlace,
    ),
  };
}

export function removeSavedPlaceState(input: {
  collections: SavedCollection[];
  savedPlace: SavedPlace;
  savedPlaces: SavedPlace[];
}) {
  const membershipIds = new Set(input.savedPlace.collections.map((collection) => collection.id));

  return {
    collections: input.collections.map((collection) =>
      membershipIds.has(collection.id)
        ? { ...collection, placeCount: Math.max(0, collection.placeCount - 1) }
        : collection,
    ),
    savedPlaces: input.savedPlaces.filter((savedPlace) => savedPlace.id !== input.savedPlace.id),
  };
}
