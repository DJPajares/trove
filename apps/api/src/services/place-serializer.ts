import {
  type PlaceSnapshot,
  type PlaceSnapshotSource,
  resolvedPlaceTimeZone,
  toPlaceCoordinates,
  toPlaceSnapshot,
} from './place-data.js';
import type { PlaceProviderName } from './places.js';

/**
 * The include every place-carrying query uses. Shared so no caller can narrow
 * away the snapshot columns and quietly send a nameless Place to a screen.
 */
export const placeProviderRefInclude = { providerRefs: true } as const;

export type SerializedPlaceProviderRef = {
  externalPlaceId: string;
  provider: PlaceProviderName;
};

export type CanonicalPlace = {
  id: string;
  kind: 'custom' | 'provider';
  /**
   * Where the Place is. A Custom Place carries the coordinates the traveller
   * gave it; a provider Place carries the ones its snapshot resolved, which is
   * why a map pin no longer waits on a provider request.
   */
  location: {
    latitude: number;
    longitude: number;
    timeZone: string | null;
  } | null;
  /** Trove-owned. A Custom Place's name; null for a provider Place. */
  name: string | null;
  note: string | null;
  providerAddress: string | null;
  providerLabel: string | null;
  providerRefs: SerializedPlaceProviderRef[];
  /** The provider's own durable answer. Null until the Place has been resolved. */
  snapshot: PlaceSnapshot | null;
};

/** The compact form an expense or a Memory carries: a Trip Place, not a Place. */
export type PlaceReference = {
  id: string;
  kind: 'custom' | 'provider';
  name: string | null;
  placeId: string;
  providerRefs: SerializedPlaceProviderRef[];
  snapshot: PlaceSnapshot | null;
};

type DecimalLike = number | { toNumber(): number };

type PlaceRecordInput = {
  customLatitude: DecimalLike | null;
  customLongitude: DecimalLike | null;
  customName: string | null;
  customNote: string | null;
  customTimeZone: string | null;
  id: string;
  kind: 'CUSTOM' | 'PROVIDER';
  providerAddress: string | null;
  providerLabel: string | null;
  providerRefs: readonly (PlaceSnapshotSource & { provider: 'GOOGLE' })[];
};

export type PlaceSerializerOptions = {
  now?: Date;
  /**
   * Snapshots refreshed during this request. The rows read alongside the Place
   * are already stale by the time a refresh lands, so the fresher copy wins.
   */
  snapshots?: ReadonlyMap<string, PlaceSnapshotSource>;
};

function toNumber(value: DecimalLike | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : value.toNumber();
}

/** The Google reference, and the freshest copy of its snapshot this request has. */
function resolveReference(
  place: Pick<PlaceRecordInput, 'providerRefs'>,
  options: PlaceSerializerOptions,
) {
  const reference = place.providerRefs.find((entry) => entry.provider === 'GOOGLE');
  if (!reference) return null;
  return options.snapshots?.get(reference.externalPlaceId) ?? reference;
}

function serializeProviderRefs(place: Pick<PlaceRecordInput, 'providerRefs'>) {
  return place.providerRefs.map((reference) => ({
    externalPlaceId: reference.externalPlaceId,
    provider: 'google' as const,
  }));
}

/**
 * One Place, serialized the same way everywhere it appears.
 *
 * A provider Place used to leave here with no name and no coordinates, which is
 * why every screen went and asked Google for them itself — the same Place
 * costing a request per surface it appeared on. The snapshot the database
 * already holds travels with the Place instead.
 */
export function serializeCanonicalPlace(
  place: PlaceRecordInput,
  options: PlaceSerializerOptions = {},
): CanonicalPlace {
  const reference = resolveReference(place, options);
  const snapshot = toPlaceSnapshot(reference, options.now);

  const customLatitude = toNumber(place.customLatitude);
  const customLongitude = toNumber(place.customLongitude);
  const timeZone = resolvedPlaceTimeZone(
    { ...place, providerRefs: reference ? [{ ...reference, provider: 'GOOGLE' }] : [] },
    options.now,
  );
  const customLocation =
    customLatitude === null || customLongitude === null
      ? null
      : { latitude: customLatitude, longitude: customLongitude, timeZone };

  // The provider's offset cannot represent daylight-saving transitions. Resolve
  // an IANA zone from its recent coordinate snapshot without another API call.
  const providerCoordinates = toPlaceCoordinates(reference);
  const providerLocation = providerCoordinates ? { ...providerCoordinates, timeZone } : null;

  return {
    id: place.id,
    kind: place.kind === 'CUSTOM' ? 'custom' : 'provider',
    location: customLocation ?? providerLocation,
    name: place.customName,
    note: place.customNote,
    providerAddress: place.providerAddress,
    providerLabel: place.providerLabel,
    providerRefs: serializeProviderRefs(place),
    snapshot,
  };
}

/**
 * The Trip Place form. `id` is the Trip Place and `placeId` the Place, which is
 * the shape expenses and Memories already key on.
 */
export function serializePlaceReference(
  tripPlace: {
    id: string;
    place: Pick<PlaceRecordInput, 'customName' | 'id' | 'kind' | 'providerRefs'>;
  },
  options: PlaceSerializerOptions = {},
): PlaceReference {
  return {
    id: tripPlace.id,
    kind: tripPlace.place.kind === 'CUSTOM' ? 'custom' : 'provider',
    name: tripPlace.place.customName,
    placeId: tripPlace.place.id,
    providerRefs: serializeProviderRefs(tripPlace.place),
    snapshot: toPlaceSnapshot(resolveReference(tripPlace.place, options), options.now),
  };
}

/**
 * What a Place is called, in the order a traveller would answer it.
 *
 * The Place's own `name` is the traveller's custom name and is null for every
 * provider-backed Place, so a chain that stops there names nothing at all for
 * an ordinary Google stop. The snapshot Trove stored when the Place was added
 * carries the provider's name, and `providerLabel` is what is left when even
 * that has not been fetched.
 *
 * Shared because this chain had drifted into four separate copies, and the one
 * in the notification builder had stopped a step early - which is how a push
 * notification came to name a trip twice instead of the stop it was about.
 */
export function resolveCanonicalPlaceName(place: {
  name: string | null;
  providerLabel?: string | null;
  snapshot?: { name?: string | null } | null;
}) {
  return place.name ?? place.snapshot?.name ?? place.providerLabel ?? null;
}

/**
 * What an itinerary item is called.
 *
 * The traveller's own label for this stop wins, then the name they gave the
 * Trip Place, then whatever the Place itself is called. A custom location
 * carries only a label, and an item with no Place at all has nothing else.
 */
export function resolveItineraryItemName(item: {
  customLabel: string | null;
  customLocation?: { label: string } | null;
  tripPlace?: {
    customName?: string | null;
    place: {
      name: string | null;
      providerLabel?: string | null;
      snapshot?: { name?: string | null } | null;
    };
  } | null;
}) {
  if (item.customLabel) return item.customLabel;
  if (item.tripPlace) {
    return item.tripPlace.customName ?? resolveCanonicalPlaceName(item.tripPlace.place);
  }

  return item.customLocation?.label ?? null;
}
