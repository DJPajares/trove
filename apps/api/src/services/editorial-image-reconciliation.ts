import { getPrismaClient } from '@trove/db';

import {
  EDITORIAL_IMAGE_RESOLUTION_VERSION,
  EditorialImageProviderError,
  editorialSubjectKey,
  type EditorialImageResolveRequest,
  type EditorialImagesService,
} from './editorial-images.js';
import { createEditorialImagesService } from './editorial-images-runtime.js';
import { categorizePlaceTypes } from './place-categories.js';
import type { TrovePlaceCategory } from './places.js';

export const DEFAULT_RECONCILIATION_LIMIT = 10;
export const DEFAULT_RECONCILIATION_PROVIDER_CALLS = 10;
export const MAX_RECONCILIATION_PROVIDER_CALLS = 25;
export const DEFAULT_RECONCILIATION_DELAY_MS = 5_000;
export const MIN_RECONCILIATION_DELAY_MS = 1_000;

const SHARED_PLACE_RECONCILIATION_OWNER = '00000000-0000-4000-8000-000000000000';

export type EditorialImageReconciliationOptions = {
  apply: boolean;
  category?: TrovePlaceCategory;
  cursor?: string;
  delayMs: number;
  limit: number;
  maxProviderCalls: number;
  placeId?: string;
  refresh: boolean;
  scope: 'all' | 'outdated';
};

export type EditorialImageReconciliationReport = {
  examined: number;
  failed: number;
  genericFallback: number;
  invalidated: number;
  mode: 'dry-run' | 'invalidate' | 'refresh';
  nextCursor: string | null;
  providerCalls: number;
  refreshed: number;
  skipped: number;
  stopped: 'provider_unavailable' | 'rate_limited' | null;
};

type ReconciliationPlace = {
  id: string;
  ownerId: string | null;
  providerAddress: string | null;
  providerLabel: string | null;
  providerRefs: Array<{
    cachedFormattedAddress: string | null;
    cachedLanguageCode: string | null;
    cachedName: string | null;
    cachedPrimaryType: string | null;
    cachedTypes: string[];
  }>;
};

type ReconciliationTrip = {
  destinations: Array<{ place: { customName: string | null; providerLabel: string | null } }>;
  id: string;
  name: string;
  ownerId: string;
};

type ReconciliationSet = {
  editorialCoverForTrips: ReconciliationTrip[];
  editorialImageForPlaces: ReconciliationPlace[];
  id: string;
  resolutionVersion: number;
  subjectKey: string;
};

type ReconciliationSubject = {
  ownerId: string;
  request: EditorialImageResolveRequest;
  setId: string;
};

type ReconciliationDependencies = {
  createService?: (beforeProviderRequest: () => Promise<void>) => EditorialImagesService | null;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

function placeCategory(place: ReconciliationPlace) {
  const reference = place.providerRefs[0];
  return categorizePlaceTypes(reference?.cachedTypes ?? [], reference?.cachedPrimaryType);
}

function toPlaceSubject(place: ReconciliationPlace, setId: string): ReconciliationSubject | null {
  const reference = place.providerRefs[0];
  const name = reference?.cachedName ?? place.providerLabel;
  if (!name?.trim()) return null;

  return {
    ownerId: place.ownerId ?? SHARED_PLACE_RECONCILIATION_OWNER,
    request: {
      placeId: place.id,
      subject: {
        address: reference?.cachedFormattedAddress ?? place.providerAddress,
        category: placeCategory(place),
        languageCode: reference?.cachedLanguageCode,
        name,
        placeId: place.id,
        primaryType: reference?.cachedPrimaryType,
        rawTypes: reference?.cachedTypes ?? [],
      },
    },
    setId,
  };
}

function toTripSubject(trip: ReconciliationTrip, setId: string): ReconciliationSubject | null {
  const destination = trip.destinations[0]?.place;
  const name = destination?.customName ?? destination?.providerLabel ?? trip.name;
  if (!name.trim()) return null;

  return {
    ownerId: trip.ownerId,
    request: {
      subject: { category: 'destination', name },
      tripId: trip.id,
    },
    setId,
  };
}

function reportMode(options: EditorialImageReconciliationOptions) {
  if (!options.apply) return 'dry-run' as const;
  return options.refresh ? ('refresh' as const) : ('invalidate' as const);
}

function matchesCategory(set: ReconciliationSet, category: TrovePlaceCategory | undefined) {
  if (!category) return true;

  return (
    set.editorialImageForPlaces.some((place) => placeCategory(place) === category) ||
    (category === 'destination' && set.editorialCoverForTrips.length > 0)
  );
}

async function readCandidates(options: EditorialImageReconciliationOptions) {
  const relationFilter = options.refresh
    ? {
        OR: [
          { editorialImageForPlaces: { some: { kind: 'PROVIDER' as const } } },
          { editorialCoverForTrips: { some: {} } },
        ],
      }
    : {};

  return (await getPrismaClient().editorialImageSet.findMany({
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    include: {
      editorialCoverForTrips: {
        select: {
          destinations: {
            orderBy: { position: 'asc' },
            select: { place: { select: { customName: true, providerLabel: true } } },
            take: 1,
          },
          id: true,
          name: true,
          ownerId: true,
        },
      },
      editorialImageForPlaces: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          ownerId: true,
          providerAddress: true,
          providerLabel: true,
          providerRefs: {
            select: {
              cachedFormattedAddress: true,
              cachedLanguageCode: true,
              cachedName: true,
              cachedPrimaryType: true,
              cachedTypes: true,
            },
            where: { provider: 'GOOGLE' },
          },
        },
        where: { kind: 'PROVIDER' },
      },
    },
    orderBy: { id: 'asc' },
    take: options.category ? Math.min(options.limit * 5, 100) : options.limit,
    where: {
      ...(options.scope === 'outdated'
        ? { resolutionVersion: { lt: EDITORIAL_IMAGE_RESOLUTION_VERSION } }
        : {}),
      ...(options.placeId ? { editorialImageForPlaces: { some: { id: options.placeId } } } : {}),
      ...relationFilter,
    },
  })) as ReconciliationSet[];
}

async function invalidateSets(ids: string[], unpin: boolean, placeId?: string) {
  if (!ids.length) return 0;

  const prisma = getPrismaClient();
  const transactions = [
    prisma.editorialImageSet.updateMany({
      data: { cachedAt: null, missedAt: null },
      where: { id: { in: ids } },
    }),
  ];

  if (unpin) {
    transactions.push(
      prisma.place.updateMany({
        data: { editorialImageSetId: null },
        where: {
          ...(placeId ? { id: placeId } : {}),
          editorialImageSetId: { in: ids },
        },
      }),
    );

    if (!placeId) {
      transactions.push(
        prisma.trip.updateMany({
          data: { editorialImageSetId: null },
          where: { editorialImageSetId: { in: ids } },
        }),
      );
    }
  }

  const [updated] = await prisma.$transaction(transactions);
  return updated?.count ?? 0;
}

function buildSubjects(
  sets: ReconciliationSet[],
  category: TrovePlaceCategory | undefined,
  placeId: string | undefined,
) {
  const subjects: ReconciliationSubject[] = [];
  let skipped = 0;

  for (const set of sets) {
    for (const place of set.editorialImageForPlaces) {
      if (placeId && place.id !== placeId) continue;
      if (category && placeCategory(place) !== category) continue;

      const subject = toPlaceSubject(place, set.id);
      if (subject) subjects.push(subject);
      else skipped += 1;
    }

    if (placeId || (category && category !== 'destination')) continue;

    for (const trip of set.editorialCoverForTrips) {
      const subject = toTripSubject(trip, set.id);
      if (subject) subjects.push(subject);
      else skipped += 1;
    }
  }

  return { skipped, subjects };
}

function createPacing(
  options: EditorialImageReconciliationOptions,
  dependencies: ReconciliationDependencies,
) {
  const now = dependencies.now ?? Date.now;
  const delay =
    dependencies.delay ??
    ((milliseconds: number) =>
      new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
  let calls = 0;
  let nextAllowedAt = 0;

  return {
    async beforeRequest() {
      if (calls >= options.maxProviderCalls) {
        throw new EditorialImageProviderError('rate_limited');
      }

      const remaining = nextAllowedAt - now();
      if (remaining > 0) await delay(remaining);

      calls += 1;
      nextAllowedAt = now() + options.delayMs;
    },
    calls: () => calls,
  };
}

/** One operator-triggered pass; nothing here runs from an application request. */
export async function reconcileEditorialImages(
  options: EditorialImageReconciliationOptions,
  dependencies: ReconciliationDependencies = {},
): Promise<EditorialImageReconciliationReport> {
  const selected = (await readCandidates(options))
    .filter((set) => matchesCategory(set, options.category))
    .slice(0, options.limit);
  const report: EditorialImageReconciliationReport = {
    examined: selected.length,
    failed: 0,
    genericFallback: 0,
    invalidated: 0,
    mode: reportMode(options),
    nextCursor: selected.at(-1)?.id ?? null,
    providerCalls: 0,
    refreshed: 0,
    skipped: 0,
    stopped: null,
  };

  if (!options.apply || selected.length === 0) return report;

  const pacing = createPacing(options, dependencies);
  const service = options.refresh
    ? dependencies.createService
      ? dependencies.createService(pacing.beforeRequest)
      : createEditorialImagesService({
          beforeProviderRequest: pacing.beforeRequest,
          source: 'editorial-image-reconciliation',
        })
    : null;

  if (options.refresh && !service) {
    throw new Error('Editorial imagery is disabled or PEXELS_API_KEY is missing.');
  }

  report.invalidated = await invalidateSets(
    selected.map((set) => set.id),
    !options.refresh,
    options.placeId,
  );

  if (!options.refresh || !service) return report;

  const { skipped, subjects } = buildSubjects(selected, options.category, options.placeId);
  report.skipped += skipped;
  let previousSetId = options.cursor ?? null;

  for (let index = 0; index < subjects.length; index += 1) {
    const entry = subjects[index] as ReconciliationSubject;
    const [result] = await service.resolveMany([entry.request], { ownerId: entry.ownerId });
    report.providerCalls = pacing.calls();

    if (result?.status === 'unavailable') {
      report.failed += 1;
      report.stopped = result.code === 'rate_limited' ? 'rate_limited' : 'provider_unavailable';
      report.nextCursor = previousSetId;
      break;
    }

    if (result?.status !== 'ok') {
      report.skipped += 1;
    } else {
      report.refreshed += 1;
      const exact = await getPrismaClient().editorialImageSet.findUnique({
        select: { missCode: true },
        where: { subjectKey: editorialSubjectKey(entry.request.subject) },
      });

      if (exact?.missCode === 'NO_VERIFIED_MATCH') report.genericFallback += 1;
    }

    const next = subjects[index + 1];
    if (!next || next.setId !== entry.setId) previousSetId = entry.setId;
  }

  if (!report.stopped) report.nextCursor = previousSetId;

  return report;
}
