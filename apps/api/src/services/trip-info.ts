import { getPrismaClient, type Prisma } from '@trove/db';

export type TripInfoInput = {
  category?: string | null;
  isPinned?: boolean;
  label?: string;
  link?: string | null;
  note?: string | null;
  value?: string;
};

export class TripInfoNotFoundError extends Error {
  constructor(code: 'trip_info_not_found' | 'trip_not_found') {
    super(code);
  }
}

export class TripInfoValidationError extends Error {
  constructor(public readonly code: 'invalid_trip_info' | 'invalid_trip_info_link') {
    super(code);
  }
}

type TripInfoRecord = Prisma.TripInfoGetPayload<Record<string, never>>;

function normalizeRequired(value: string | undefined) {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new TripInfoValidationError('invalid_trip_info');
  return normalized;
}

function normalizeOptional(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeLink(value: string | null | undefined) {
  const link = normalizeOptional(value);
  if (!link) return null;

  try {
    const url = new URL(link);
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
      throw new Error('unsupported_link_protocol');
    }
    return url.toString();
  } catch {
    throw new TripInfoValidationError('invalid_trip_info_link');
  }
}

function serializeTripInfo(entry: TripInfoRecord) {
  return {
    category: entry.category,
    createdAt: entry.createdAt.toISOString(),
    id: entry.id,
    isPinned: entry.isPinned,
    label: entry.label,
    link: entry.link,
    note: entry.note,
    updatedAt: entry.updatedAt.toISOString(),
    value: entry.value,
  };
}

async function findOwnedTrip(
  transaction: Prisma.TransactionClient,
  userId: string,
  tripId: string,
) {
  const trip = await transaction.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: { id: true, name: true },
  });
  if (!trip) throw new TripInfoNotFoundError('trip_not_found');
  return trip;
}

export async function listTripInfo(userId: string, tripId: string) {
  const trip = await getPrismaClient().trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: {
      tripInfoEntries: {
        orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
      },
    },
  });
  if (!trip) throw new TripInfoNotFoundError('trip_not_found');

  return {
    entries: trip.tripInfoEntries.map(serializeTripInfo),
    trip: { id: trip.id, name: trip.name },
  };
}

export async function createTripInfo(
  userId: string,
  tripId: string,
  input: Required<Pick<TripInfoInput, 'label' | 'value'>> & TripInfoInput,
) {
  const prisma = getPrismaClient();
  const entryId = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    return (
      await transaction.tripInfo.create({
        data: {
          category: normalizeOptional(input.category),
          isPinned: input.isPinned ?? false,
          label: normalizeRequired(input.label),
          link: normalizeLink(input.link),
          note: normalizeOptional(input.note),
          tripId,
          value: normalizeRequired(input.value),
        },
      })
    ).id;
  });
  const entry = await prisma.tripInfo.findFirst({
    where: { id: entryId, trip: { ownerId: userId }, tripId },
  });
  if (!entry) throw new TripInfoNotFoundError('trip_info_not_found');
  return serializeTripInfo(entry);
}

export async function updateTripInfo(
  userId: string,
  tripId: string,
  entryId: string,
  input: TripInfoInput,
) {
  const prisma = getPrismaClient();
  const updatedId = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const current = await transaction.tripInfo.findFirst({ where: { id: entryId, tripId } });
    if (!current) throw new TripInfoNotFoundError('trip_info_not_found');

    await transaction.tripInfo.update({
      where: { id: current.id },
      data: {
        ...(input.category !== undefined ? { category: normalizeOptional(input.category) } : {}),
        ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
        ...(input.label !== undefined ? { label: normalizeRequired(input.label) } : {}),
        ...(input.link !== undefined ? { link: normalizeLink(input.link) } : {}),
        ...(input.note !== undefined ? { note: normalizeOptional(input.note) } : {}),
        ...(input.value !== undefined ? { value: normalizeRequired(input.value) } : {}),
      },
    });
    return current.id;
  });
  const entry = await prisma.tripInfo.findFirst({
    where: { id: updatedId, trip: { ownerId: userId }, tripId },
  });
  if (!entry) throw new TripInfoNotFoundError('trip_info_not_found');
  return serializeTripInfo(entry);
}

export async function deleteTripInfo(userId: string, tripId: string, entryId: string) {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const entry = await transaction.tripInfo.findFirst({
      where: { id: entryId, tripId },
      select: { id: true },
    });
    if (!entry) throw new TripInfoNotFoundError('trip_info_not_found');
    await transaction.tripInfo.delete({ where: { id: entry.id } });
  });
}
