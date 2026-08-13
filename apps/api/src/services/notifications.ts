import { getPrismaClient } from '@trove/db';

import { floatingLocalTimeToInstant, formatLocalTime } from './itinerary-rules.js';
import { resolveTripModeContext } from './trip-mode-context.js';
import { deriveTripLifecycle, formatDateOnly } from './trip-rules.js';

const TASK_LEAD_MS = 60 * 60 * 1_000;
const RESERVATION_LEAD_MS = 2 * 60 * 60 * 1_000;
const LEAVE_BY_LEAD_MS = 45 * 60 * 1_000;
const RECENT_EVENT_MS = 30 * 60 * 1_000;

type NotificationCandidate = {
  eventAt: Date;
  kind: 'LEAVE_BY' | 'RESERVATION_UPCOMING' | 'TASK_DUE';
  label: string;
  sourceId: string;
  sourceVersion: string;
  timeZone: string;
  tripId: string;
  tripName: string;
};

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

function taskCandidate(
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
      sourceVersion: `${task.updatedAt.toISOString()}:${eventAt.toISOString()}`,
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

function reservationCandidate(
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
    sourceVersion: `${reservation.updatedAt.toISOString()}:${event.eventAt.toISOString()}`,
    timeZone: event.timeZone,
    tripId: trip.id,
    tripName: trip.name,
  };
}

function itineraryItemLabel(item: {
  customLabel: string | null;
  customLocation: { label: string } | null;
  tripPlace: { place: { name: string | null } } | null;
}) {
  return item.customLabel ?? item.customLocation?.label ?? item.tripPlace?.place.name ?? null;
}

async function leaveByCandidate(
  userId: string,
  trip: { id: string; name: string },
  now: Date,
): Promise<NotificationCandidate | null> {
  try {
    const context = await resolveTripModeContext(userId, trip.id, { at: now });
    if (!context.leaveBy || !context.day) return null;
    const eventAt = new Date(context.leaveBy.at);
    if (!inNotificationWindow(eventAt, now, LEAVE_BY_LEAD_MS)) return null;
    const destination = context.day.items.find(
      (item) => item.id === context.leaveBy?.destinationItemId,
    );
    if (!destination) return null;
    return {
      eventAt,
      kind: 'LEAVE_BY',
      label: itineraryItemLabel(destination) ?? trip.name,
      sourceId: destination.id,
      sourceVersion: [
        context.leaveBy.targetStartAt,
        context.leaveBy.originItemId,
        context.leaveBy.routeDurationSeconds,
        context.leaveBy.mode,
      ].join(':'),
      timeZone: destination.timeZone ?? context.day.defaultTimeZone,
      tripId: trip.id,
      tripName: trip.name,
    };
  } catch {
    return null;
  }
}

async function upsertCandidate(userId: string, candidate: NotificationCandidate) {
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
      return prisma.notification.update({
        where: key,
        data: {
          browserDeliveredAt: null,
          eventAt: candidate.eventAt,
          readAt: null,
          sourceVersion: candidate.sourceVersion,
          timeZone: candidate.timeZone,
          tripId: candidate.tripId,
        },
      });
    }
  }

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

  const activeTrips = trips.filter(
    (trip) =>
      deriveTripLifecycle(
        formatDateOnly(trip.startDate),
        formatDateOnly(trip.endDate),
        trip.referenceTimeZone,
        now,
      ) === 'active',
  );
  const leaveBy = await Promise.all(activeTrips.map((trip) => leaveByCandidate(userId, trip, now)));
  candidates.push(...leaveBy.filter((candidate) => candidate !== null));

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
  const profile = await getPrismaClient().profile.update({
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
