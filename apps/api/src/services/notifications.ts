import { getPrismaClient, type Prisma } from '@trove/db';

import { floatingLocalTimeToInstant, formatLocalTime } from './itinerary-rules.js';
import { isSnapshotFresh, toPlaceCoordinates } from './place-data.js';
import { resolveItineraryItemName } from './place-serializer.js';
import { resolveTripModeItemSelection, LEAVE_BY_BUFFER_SECONDS } from './trip-mode-context.js';
import { deriveTripLifecycle, formatDateOnly } from './trip-rules.js';

const TASK_LEAD_MS = 60 * 60 * 1_000;
const RESERVATION_LEAD_MS = 2 * 60 * 60 * 1_000;
const LEAVE_BY_LEAD_MS = 45 * 60 * 1_000;
const RECENT_EVENT_MS = 30 * 60 * 1_000;

export type NotificationCandidate = {
  eventAt: Date;
  kind: 'LEAVE_BY' | 'RESERVATION_UPCOMING' | 'TASK_DUE';
  label: string;
  sourceId: string;
  sourceVersion: string;
  timeZone: string;
  tripId: string;
  tripName: string;
};

const pushLeaveByInclude = {
  trip: {
    select: {
      id: true,
      name: true,
      ownerId: true,
      startDate: true,
      endDate: true,
      referenceTimeZone: true,
    },
  },
  itineraryDay: {
    include: {
      items: {
        where: { travelStatus: 'UPCOMING' as const },
        orderBy: { position: 'asc' as const },
        include: { tripPlace: { include: { place: { include: { providerRefs: true } } } } },
      },
    },
  },
} as const;
type PushLeaveByItem = Prisma.ItineraryItemGetPayload<{ include: typeof pushLeaveByInclude }>;

export type NotificationSettingsInput = {
  browserEnabled?: boolean;
  enabled?: boolean;
};

export class NotificationNotFoundError extends Error {
  constructor(code: 'notification_not_found' | 'profile_not_found' | 'trip_not_found') {
    super(code);
  }
}

function inNotificationWindow(eventAt: Date, now: Date, leadMs: number) {
  const difference = eventAt.getTime() - now.getTime();
  return difference <= leadMs && difference >= -RECENT_EVENT_MS;
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export function taskCandidate(
  task: {
    dueDate: Date | null;
    dueLocalTime: Date | null;
    dueTimeZone: string | null;
    id: string;
    label: string;
    updatedAt: Date;
  },
  trip: { id: string; name: string },
  now: Date,
): NotificationCandidate | null {
  if (!task.dueDate || !task.dueLocalTime || !task.dueTimeZone) return null;
  try {
    const eventAt = floatingLocalTimeToInstant(
      formatDateOnly(task.dueDate),
      formatLocalTime(task.dueLocalTime)!,
      task.dueTimeZone,
    );
    if (!inNotificationWindow(eventAt, now, TASK_LEAD_MS)) return null;
    return {
      eventAt,
      kind: 'TASK_DUE',
      label: task.label,
      sourceId: task.id,
      sourceVersion: `${eventAt.toISOString()}:${task.dueTimeZone}:${task.label}:${trip.name}`,
      timeZone: task.dueTimeZone,
      tripId: trip.id,
      tripName: trip.name,
    };
  } catch {
    return null;
  }
}

function reservationEvent(reservation: {
  flightDepartureInstant: Date | null;
  flightDepartureLocalDate: Date | null;
  flightDepartureLocalTime: Date | null;
  flightDepartureTimeZone: string | null;
  localDate: Date | null;
  localTime: Date | null;
  timeZone: string | null;
}) {
  if (reservation.flightDepartureInstant && reservation.flightDepartureTimeZone) {
    return {
      eventAt: reservation.flightDepartureInstant,
      timeZone: reservation.flightDepartureTimeZone,
    };
  }

  const date = reservation.flightDepartureLocalDate ?? reservation.localDate;
  const time = reservation.flightDepartureLocalTime ?? reservation.localTime;
  const timeZone = reservation.flightDepartureTimeZone ?? reservation.timeZone;
  if (!date || !time || !timeZone) return null;

  try {
    return {
      eventAt: floatingLocalTimeToInstant(formatDateOnly(date), formatLocalTime(time)!, timeZone),
      timeZone,
    };
  } catch {
    return null;
  }
}

export function reservationCandidate(
  reservation: {
    flightDepartureInstant: Date | null;
    flightDepartureLocalDate: Date | null;
    flightDepartureLocalTime: Date | null;
    flightDepartureTimeZone: string | null;
    id: string;
    localDate: Date | null;
    localTime: Date | null;
    timeZone: string | null;
    title: string;
    updatedAt: Date;
  },
  trip: { id: string; name: string },
  now: Date,
): NotificationCandidate | null {
  const event = reservationEvent(reservation);
  if (!event || !inNotificationWindow(event.eventAt, now, RESERVATION_LEAD_MS)) return null;
  return {
    eventAt: event.eventAt,
    kind: 'RESERVATION_UPCOMING',
    label: reservation.title,
    sourceId: reservation.id,
    sourceVersion: `${event.eventAt.toISOString()}:${event.timeZone}:${reservation.title}:${trip.name}`,
    timeZone: event.timeZone,
    tripId: trip.id,
    tripName: trip.name,
  };
}

export async function upsertCandidate(
  userId: string,
  candidate: NotificationCandidate,
): Promise<Prisma.NotificationGetPayload<object>> {
  const prisma = getPrismaClient();
  const key = {
    ownerId_kind_sourceId: {
      kind: candidate.kind,
      ownerId: userId,
      sourceId: candidate.sourceId,
    },
  } as const;
  const current = await prisma.notification.findUnique({ where: key });

  if (!current) {
    try {
      return await prisma.notification.create({
        data: {
          eventAt: candidate.eventAt,
          kind: candidate.kind,
          ownerId: userId,
          sourceId: candidate.sourceId,
          sourceVersion: candidate.sourceVersion,
          timeZone: candidate.timeZone,
          tripId: candidate.tripId,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      return upsertCandidate(userId, candidate);
    }
  }

  if (
    current.sourceVersion === candidate.sourceVersion &&
    current.eventAt.getTime() === candidate.eventAt.getTime() &&
    current.timeZone === candidate.timeZone &&
    current.tripId === candidate.tripId
  )
    return current;
  return prisma.notification.update({
    where: { id: current.id },
    data: {
      eventAt: candidate.eventAt,
      sourceVersion: candidate.sourceVersion,
      timeZone: candidate.timeZone,
      tripId: candidate.tripId,
      ...(current.sourceVersion === candidate.sourceVersion
        ? {}
        : { browserDeliveredAt: null, readAt: null }),
    },
  });
}

/** Due-source scan for dispatch. All source queries are bounded and indexed; the
 * exact local-time and status rules are the same functions as the in-app read. */
export async function listDueNotificationCandidates(now = new Date()) {
  const prisma = getPrismaClient();
  const floor = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
  const ceiling = new Date(now.getTime() + 2 * 24 * 60 * 60_000);
  const activeTrip = {
    owner: {
      notificationsEnabled: true,
      browserNotificationsEnabled: true,
      pushSubscriptions: { some: {} },
    },
    notificationPreferences: { none: { muted: true } },
  } as const;
  const [tasks, reservations, timedItems] = await Promise.all([
    prisma.task.findMany({
      where: {
        completedAt: null,
        dueDate: { gte: floor, lte: ceiling },
        dueLocalTime: { not: null },
        trip: activeTrip,
      },
      include: { trip: { select: { id: true, name: true, ownerId: true } } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 500,
    }),
    prisma.reservation.findMany({
      where: {
        trip: activeTrip,
        OR: [
          { flightDepartureInstant: { gte: floor, lte: ceiling } },
          {
            flightDepartureLocalDate: { gte: floor, lte: ceiling },
            flightDepartureLocalTime: { not: null },
          },
          { localDate: { gte: floor, lte: ceiling }, localTime: { not: null } },
        ],
      },
      include: { trip: { select: { id: true, name: true, ownerId: true } } },
      orderBy: { id: 'asc' },
      take: 500,
    }),
    prisma.itineraryItem.findMany({
      where: {
        travelStatus: 'UPCOMING',
        startInstant: { gt: now, lte: new Date(now.getTime() + 8 * 60 * 60_000) },
        itineraryDayId: { not: null },
        trip: activeTrip,
      },
      include: pushLeaveByInclude,
      orderBy: [{ startInstant: 'asc' }, { id: 'asc' }],
      take: 500,
    }),
  ]);

  const due = (candidate: NotificationCandidate | null, lead: number, ownerId: string) =>
    candidate && candidate.eventAt > now && now.getTime() >= candidate.eventAt.getTime() - lead
      ? { candidate, ownerId }
      : null;
  const candidates = [
    ...tasks.map((task) =>
      due(taskCandidate(task, task.trip, now), TASK_LEAD_MS, task.trip.ownerId),
    ),
    ...reservations.map((reservation) =>
      due(
        reservationCandidate(reservation, reservation.trip, now),
        RESERVATION_LEAD_MS,
        reservation.trip.ownerId,
      ),
    ),
  ].filter((value): value is NonNullable<typeof value> => value !== null);

  for (const item of timedItems) {
    const candidate = await cachedLeaveByCandidate(item, now);
    const result = due(candidate, LEAVE_BY_LEAD_MS, item.trip.ownerId);
    if (result) candidates.push(result);
  }
  return candidates.toSorted(
    (left, right) => left.candidate.eventAt.getTime() - right.candidate.eventAt.getTime(),
  );
}

async function cachedLeaveByCandidate(
  item: PushLeaveByItem,
  now: Date,
): Promise<NotificationCandidate | null> {
  const day = item.itineraryDay;
  if (!day || !item.startInstant) return null;
  if (
    deriveTripLifecycle(
      formatDateOnly(item.trip.startDate),
      formatDateOnly(item.trip.endDate),
      item.trip.referenceTimeZone,
      now,
    ) !== 'active'
  )
    return null;
  const selection = resolveTripModeItemSelection(
    day.items,
    formatDateOnly(day.date),
    day.defaultTimeZone,
    now,
  );
  if (selection.nextItem?.id !== item.id || !selection.currentOrRelevant) return null;
  const origin = selection.currentOrRelevant.item;
  const target = selection.nextItem;
  if (!origin.tripPlace || !target.tripPlace) return null;
  const originCoordinate = cachedCoordinates(origin.tripPlace.place, now);
  const destinationCoordinate = cachedCoordinates(target.tripPlace.place, now);
  if (!originCoordinate || !destinationCoordinate || origin.travelModeToNext === 'FLIGHT')
    return null;
  const coordinate = (value: number) => Math.round(value * 1e6) / 1e6;
  const leg = await getPrismaClient().travelLegCache.findUnique({
    where: {
      travel_leg_cache_leg: {
        originLatitude: coordinate(originCoordinate.latitude),
        originLongitude: coordinate(originCoordinate.longitude),
        destinationLatitude: coordinate(destinationCoordinate.latitude),
        destinationLongitude: coordinate(destinationCoordinate.longitude),
        mode: origin.travelModeToNext,
      },
    },
  });
  if (!leg || now.getTime() - leg.fetchedAt.getTime() > 30 * 24 * 60 * 60_000) return null;
  const eventAt = new Date(
    item.startInstant.getTime() - (leg.durationSeconds + LEAVE_BY_BUFFER_SECONDS) * 1_000,
  );
  const place = target.tripPlace?.place;
  const label =
    resolveItineraryItemName({
      customLabel: target.customLabel,
      customLocation: target.customLocation ? { label: target.customLocation } : null,
      tripPlace:
        target.tripPlace && place
          ? {
              customName: target.tripPlace.customName,
              place: {
                name: place.customName,
                providerLabel: place.providerLabel,
                snapshot: {
                  name: place.providerRefs.find((reference) => reference.provider === 'GOOGLE')
                    ?.cachedName,
                },
              },
            }
          : null,
    }) ?? item.trip.name;
  return {
    eventAt,
    kind: 'LEAVE_BY',
    label,
    sourceId: item.id,
    sourceVersion: `${item.startInstant.toISOString()}:${origin.id}:${leg.durationSeconds}:${origin.travelModeToNext.toLowerCase()}:${label}:${item.trip.name}`,
    timeZone: item.timeZone ?? day.defaultTimeZone,
    tripId: item.tripId,
    tripName: item.trip.name,
  };
}

/** Fresh, targeted revalidation immediately before a send. No provider path exists here. */
export async function currentDueCandidate(
  candidate: NotificationCandidate,
  ownerId: string,
  now: Date,
) {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: {
      id: candidate.tripId,
      ownerId,
      owner: { notificationsEnabled: true, browserNotificationsEnabled: true },
      notificationPreferences: { none: { ownerId, muted: true } },
    },
    select: { id: true, name: true },
  });
  if (!trip) return null;
  let current: NotificationCandidate | null = null;
  let lead = 0;
  if (candidate.kind === 'TASK_DUE') {
    const task = await prisma.task.findFirst({
      where: { id: candidate.sourceId, tripId: trip.id, completedAt: null },
    });
    current = task ? taskCandidate(task, trip, now) : null;
    lead = TASK_LEAD_MS;
  } else if (candidate.kind === 'RESERVATION_UPCOMING') {
    const reservation = await prisma.reservation.findFirst({
      where: { id: candidate.sourceId, tripId: trip.id },
    });
    current = reservation ? reservationCandidate(reservation, trip, now) : null;
    lead = RESERVATION_LEAD_MS;
  } else {
    const item = await prisma.itineraryItem.findFirst({
      where: { id: candidate.sourceId, tripId: trip.id, travelStatus: 'UPCOMING' },
      include: pushLeaveByInclude,
    });
    current = item ? await cachedLeaveByCandidate(item, now) : null;
    lead = LEAVE_BY_LEAD_MS;
  }
  return current &&
    current.eventAt > now &&
    now.getTime() >= current.eventAt.getTime() - lead &&
    current.sourceVersion === candidate.sourceVersion &&
    current.eventAt.getTime() === candidate.eventAt.getTime()
    ? current
    : null;
}

function cachedCoordinates(
  place: {
    customLatitude: { toNumber(): number } | null;
    customLongitude: { toNumber(): number } | null;
    providerRefs: Array<Parameters<typeof isSnapshotFresh>[0] & { provider: string }>;
  },
  now: Date,
) {
  if (place.customLatitude && place.customLongitude) {
    return {
      latitude: place.customLatitude.toNumber(),
      longitude: place.customLongitude.toNumber(),
    };
  }
  const reference = place.providerRefs.find((value) => value.provider === 'GOOGLE');
  return reference && isSnapshotFresh(reference, { now }) ? toPlaceCoordinates(reference) : null;
}

function actionPath(kind: NotificationCandidate['kind'], tripId: string) {
  if (kind === 'TASK_DUE') return `/trips/${tripId}/tasks`;
  if (kind === 'RESERVATION_UPCOMING') return `/trips/${tripId}/reservations`;
  return `/trips/${tripId}/mode`;
}

function serializeSettings(profile: {
  browserNotificationsEnabled: boolean;
  notificationsEnabled: boolean;
}) {
  return {
    browserEnabled: profile.browserNotificationsEnabled,
    enabled: profile.notificationsEnabled,
  };
}

async function getProfileSettings(userId: string) {
  const profile = await getPrismaClient().profile.findUnique({
    where: { id: userId },
    select: { browserNotificationsEnabled: true, notificationsEnabled: true },
  });
  if (!profile) throw new NotificationNotFoundError('profile_not_found');
  return profile;
}

export async function listNotifications(userId: string, now = new Date()) {
  const prisma = getPrismaClient();
  const profile = await getProfileSettings(userId);
  const settings = serializeSettings(profile);
  if (!settings.enabled) return { notifications: [], settings };

  const dateFloor = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1_000);
  const dateCeiling = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1_000);
  const trips = await prisma.trip.findMany({
    where: {
      ownerId: userId,
      notificationPreferences: { none: { muted: true, ownerId: userId } },
    },
    select: {
      endDate: true,
      id: true,
      name: true,
      referenceTimeZone: true,
      reservations: {
        where: {
          OR: [
            { localDate: { gte: dateFloor, lte: dateCeiling }, localTime: { not: null } },
            {
              flightDepartureLocalDate: { gte: dateFloor, lte: dateCeiling },
              flightDepartureLocalTime: { not: null },
            },
            { flightDepartureInstant: { gte: dateFloor, lte: dateCeiling } },
          ],
        },
        select: {
          flightDepartureInstant: true,
          flightDepartureLocalDate: true,
          flightDepartureLocalTime: true,
          flightDepartureTimeZone: true,
          id: true,
          localDate: true,
          localTime: true,
          timeZone: true,
          title: true,
          updatedAt: true,
        },
      },
      startDate: true,
      tasks: {
        where: {
          completedAt: null,
          dueDate: { gte: dateFloor, lte: dateCeiling },
          dueLocalTime: { not: null },
        },
        select: {
          dueDate: true,
          dueLocalTime: true,
          dueTimeZone: true,
          id: true,
          label: true,
          updatedAt: true,
        },
      },
    },
  });

  const candidates: NotificationCandidate[] = [];
  for (const trip of trips) {
    for (const task of trip.tasks) {
      const candidate = taskCandidate(task, trip, now);
      if (candidate) candidates.push(candidate);
    }
    for (const reservation of trip.reservations) {
      const candidate = reservationCandidate(reservation, trip, now);
      if (candidate) candidates.push(candidate);
    }
  }

  const timedItems = await prisma.itineraryItem.findMany({
    where: {
      trip: {
        ownerId: userId,
        notificationPreferences: { none: { ownerId: userId, muted: true } },
      },
      travelStatus: 'UPCOMING',
      itineraryDayId: { not: null },
      startInstant: {
        gte: new Date(now.getTime() - 8 * 60 * 60_000),
        lte: new Date(now.getTime() + 8 * 60 * 60_000),
      },
    },
    include: pushLeaveByInclude,
    orderBy: [{ startInstant: 'asc' }, { id: 'asc' }],
    take: 500,
  });
  for (const item of timedItems) {
    const candidate = await cachedLeaveByCandidate(item, now);
    if (candidate && inNotificationWindow(candidate.eventAt, now, LEAVE_BY_LEAD_MS)) {
      candidates.push(candidate);
    }
  }

  const records = await Promise.all(
    candidates.map((candidate) => upsertCandidate(userId, candidate)),
  );
  const recordBySource = new Map(
    records.map((record) => [`${record.kind}:${record.sourceId}`, record]),
  );

  return {
    notifications: candidates
      .map((candidate) => ({
        candidate,
        record: recordBySource.get(`${candidate.kind}:${candidate.sourceId}`),
      }))
      .filter(({ record }) => record && !record.readAt)
      .map(({ candidate, record }) => ({
        actionPath: actionPath(candidate.kind, candidate.tripId),
        browserDeliveredAt: record!.browserDeliveredAt?.toISOString() ?? null,
        eventAt: candidate.eventAt.toISOString(),
        id: record!.id,
        kind: candidate.kind.toLowerCase() as 'leave_by' | 'reservation_upcoming' | 'task_due',
        label: candidate.label,
        timeZone: candidate.timeZone,
        trip: { id: candidate.tripId, name: candidate.tripName },
      }))
      .toSorted((left, right) => left.eventAt.localeCompare(right.eventAt)),
    settings,
  };
}

export async function updateNotificationSettings(userId: string, input: NotificationSettingsInput) {
  await getProfileSettings(userId);
  const enabled = input.browserEnabled ? true : input.enabled;
  const prisma = getPrismaClient();
  const profile = await prisma.$transaction(async (tx) => {
    const updated = await tx.profile.update({
      where: { id: userId },
      data: {
        ...(enabled === undefined ? {} : { notificationsEnabled: enabled }),
        ...(input.browserEnabled === undefined
          ? enabled === false
            ? { browserNotificationsEnabled: false }
            : {}
          : { browserNotificationsEnabled: input.browserEnabled }),
      },
      select: { browserNotificationsEnabled: true, notificationsEnabled: true },
    });
    if (!updated.browserNotificationsEnabled || !updated.notificationsEnabled) {
      await tx.pushSubscription.deleteMany({ where: { ownerId: userId } });
    }
    return updated;
  });
  return serializeSettings(profile);
}

export async function getTripNotificationPreference(userId: string, tripId: string) {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({ where: { id: tripId, ownerId: userId } });
  if (!trip) throw new NotificationNotFoundError('trip_not_found');
  const preference = await prisma.tripNotificationPreference.findUnique({
    where: { ownerId_tripId: { ownerId: userId, tripId } },
  });
  return { muted: preference?.muted ?? false };
}

export async function updateTripNotificationPreference(
  userId: string,
  tripId: string,
  muted: boolean,
) {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({ where: { id: tripId, ownerId: userId } });
  if (!trip) throw new NotificationNotFoundError('trip_not_found');
  const preference = await prisma.tripNotificationPreference.upsert({
    where: { ownerId_tripId: { ownerId: userId, tripId } },
    create: { muted, ownerId: userId, tripId },
    update: { muted },
  });
  if (muted) {
    await prisma.notification.updateMany({
      where: { ownerId: userId, readAt: null, tripId },
      data: { readAt: new Date() },
    });
  }
  return { muted: preference.muted };
}

export async function updateNotification(
  userId: string,
  notificationId: string,
  input: { browserDelivered?: boolean; read?: boolean },
) {
  const prisma = getPrismaClient();
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, ownerId: userId },
  });
  if (!notification) throw new NotificationNotFoundError('notification_not_found');
  await prisma.notification.update({
    where: { id: notification.id },
    data: {
      ...(input.browserDelivered ? { browserDeliveredAt: new Date() } : {}),
      ...(input.read ? { readAt: new Date() } : {}),
    },
  });
}

export async function markAllNotificationsRead(userId: string) {
  await getPrismaClient().notification.updateMany({
    where: { ownerId: userId, readAt: null },
    data: { readAt: new Date() },
  });
}
