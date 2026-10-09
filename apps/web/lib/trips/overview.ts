import {
  isTripOverviewTaskRelevant,
  selectTripOverviewDay,
  type TripOverviewData,
  type TripOverviewStop,
} from '@trove/types';
import { offlineTripModeContext, type ItineraryItem } from '@/lib/itinerary/api';
import type { OfflineTripSnapshot } from '@/lib/offline/trip-store';
import { calendarDayDistance, getLocalDate } from '@/lib/trips/lifecycle';
import type { Trip } from '@/lib/trips/api';

export function overviewLifecycle(
  trip: Pick<Trip, 'startDate' | 'endDate' | 'referenceTimeZone'>,
  now: Date,
): TripOverviewData['lifecycle'] {
  const date = getLocalDate(now, trip.referenceTimeZone);
  return date < trip.startDate ? 'planning' : date > trip.endDate ? 'completed' : 'active';
}

export function overviewPlannerHref(tripId: string, dayId: string | null) {
  return `/trips/${tripId}/itinerary${dayId ? `?day=${encodeURIComponent(dayId)}` : ''}`;
}

/** Derive the hub from the existing, mutation-aware snapshot. No second persisted copy. */
export function offlineTripOverview(
  snapshot: OfflineTripSnapshot,
  clockTimeZone: string,
  now = new Date(),
): TripOverviewData {
  if (!snapshot.trip) throw new Error('trip_not_prepared');
  const trip = snapshot.trip;
  const lifecycle = overviewLifecycle(trip, now);
  const today = getLocalDate(now, clockTimeZone);
  const days = (snapshot.itinerary?.days ?? []).map((day, index) => ({
    ...day,
    number: index + 1,
    stopCount: day.items.length,
  }));
  const day = selectTripOverviewDay(days, lifecycle, today);
  const context =
    lifecycle === 'active' && snapshot.itinerary
      ? offlineTripModeContext(snapshot.itinerary, { at: now.toISOString(), clockTimeZone })
      : null;
  const item = (id: string | undefined | null) =>
    day?.items.find((candidate) => candidate.id === id) ?? null;
  const toStop = (
    item: ItineraryItem | null,
    kind: TripOverviewStop['kind'],
  ): TripOverviewStop | null =>
    item
      ? {
          id: item.id,
          label:
            item.customLabel ??
            item.tripPlace?.customName ??
            item.tripPlace?.place.name ??
            (item.tripPlace?.place.snapshot &&
            !item.tripPlace.place.snapshot.stale &&
            now.getTime() - Date.parse(item.tripPlace.place.snapshot.fetchedAt) < 30 * 86_400_000
              ? item.tripPlace.place.snapshot.name
              : null) ??
            item.customLocation?.label ??
            null,
          localStartTime: item.localStartTime,
          // Only authoritative instants are shown as times offline; floating local times use their wall clock.
          startInstant: item.timeSemantics === 'authoritative_instant' ? item.startInstant : null,
          kind,
        }
      : null;
  const current = toStop(
    item(context?.currentOrRelevant?.itemId),
    context?.currentOrRelevant?.kind ?? 'relevant',
  );
  const next =
    lifecycle === 'planning'
      ? toStop(day?.items[0] ?? null, 'planned')
      : toStop(item(context?.nextItemId), 'next');
  const tasks = (snapshot.tasks?.tasks ?? [])
    .filter(
      (task) =>
        !task.completed &&
        isTripOverviewTaskRelevant(
          {
            dayId: task.context.kind === 'day' ? task.context.itineraryDayId : null,
            itemId: task.context.kind === 'item' ? task.context.itineraryItemId : null,
            dueDate: task.dueDate,
          },
          lifecycle,
          today,
          day?.id ?? null,
          [current?.id, next?.id].filter((id): id is string => Boolean(id)),
        ),
    )
    .toSorted(
      (a, b) =>
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const memories = (snapshot.memories?.memories ?? []).toSorted(
    (a, b) =>
      Number(b.isHighlight) - Number(a.isHighlight) ||
      (a.highlightPosition ?? Infinity) - (b.highlightPosition ?? Infinity) ||
      a.capturedAt.localeCompare(b.capturedAt),
  );
  const cover = snapshot.memories?.storyCover;
  const photos = [
    ...(cover?.url
      ? [
          {
            id: cover.photoId,
            url: cover.url,
            contentType:
              memories
                .flatMap((memory) => memory.photos)
                .find((photo) => photo.id === cover.photoId)?.contentType ?? 'image/jpeg',
          },
        ]
      : []),
    ...memories.flatMap((memory) => (memory.photos[0]?.url ? [memory.photos[0]] : [])),
  ]
    .filter((photo, index, all) => all.findIndex((entry) => entry.id === photo.id) === index)
    .slice(0, 3)
    .map((photo) => ({ id: photo.id, contentType: photo.contentType, url: photo.url! }));
  return {
    generatedAt: now.toISOString(),
    refreshAt: new Date(now.getTime() + 60_000).toISOString(),
    clockTimeZone,
    lifecycle,
    destinations: (trip.destinations ?? []).map(({ id, name }) => ({ id, name: name || null })),
    day: day
      ? {
          id: day.id,
          name: day.name,
          date: day.date,
          number: calendarDayDistance(trip.startDate, day.date) + 1,
          stopCount: day.stopCount,
          state:
            day.stopCount === 0
              ? 'empty'
              : lifecycle === 'active' && !current && !next
                ? 'finished'
                : 'planned',
          current,
          next,
        }
      : null,
    tasks: {
      openCount: tasks.length,
      next: tasks[0] ? { id: tasks[0].id, label: tasks[0].label, dueDate: tasks[0].dueDate } : null,
    },
    memories: {
      photos: lifecycle === 'completed' ? photos : [],
      note: memories.find((memory) => memory.note?.trim())?.note ?? null,
    },
    pinnedInfo: (snapshot.tripInfo?.entries ?? [])
      .filter((entry) => entry.isPinned)
      .slice(0, 3)
      .map(({ id, label, value }) => ({ id, label, value })),
  };
}
