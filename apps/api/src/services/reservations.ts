import type { SupabaseClient } from '@supabase/supabase-js';
import { getPrismaClient, type Prisma } from '@trove/db';

import { formatInstantInTimeZone, formatLocalTime, parseLocalTime } from './itinerary-rules.js';
import { refreshDayDefaultTimeZone } from './itineraries.js';
import { createAuthenticatedSupabaseClient } from './supabase-auth.js';
import { formatDateOnly, isValidIanaTimeZone } from './trip-rules.js';

export const RESERVATION_DOCUMENTS_BUCKET = 'reservation-documents';

const allowedDocumentTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const maxDocumentSize = 10 * 1024 * 1024;

export type PlannedCostInput = { amount: string; currencyCode: string };
export type ReservationType =
  | 'accommodation'
  | 'attraction'
  | 'bus'
  | 'ferry'
  | 'flight'
  | 'other'
  | 'rental_car'
  | 'restaurant'
  | 'tour'
  | 'train';

export type ReservationInput = {
  accommodationAddress?: string | null;
  applicableDayIds?: string[];
  bookingReference?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  flight?: FlightDetailsInput | null;
  itineraryItemId?: string | null;
  localDate?: string | null;
  localTime?: string | null;
  notes?: string | null;
  plannedCost?: PlannedCostInput | null;
  provider?: string | null;
  title?: string;
  tripPlaceId?: string | null;
  transport?: TransportDetailsInput | null;
  type?: ReservationType | null;
};

export type FlightEndpointInput = {
  airport?: string | null;
  authoritativeInstant?: string | null;
  localDate?: string | null;
  localTime?: string | null;
  timeZone?: string | null;
};

export type FlightDetailsInput = {
  airline?: string | null;
  arrival?: FlightEndpointInput | null;
  departure?: FlightEndpointInput | null;
  gate?: string | null;
  number?: string | null;
  seat?: string | null;
  terminal?: string | null;
};

export type TransportDetailsInput = {
  dropoffLocation?: string | null;
  operator?: string | null;
  pickupLocation?: string | null;
  serviceNumber?: string | null;
};

export class ReservationNotFoundError extends Error {
  constructor(
    code:
      | 'itinerary_day_not_found'
      | 'itinerary_item_not_found'
      | 'reservation_attachment_not_found'
      | 'reservation_not_found'
      | 'trip_not_found'
      | 'trip_place_not_found',
  ) {
    super(code);
  }
}

export class ReservationValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_accommodation'
      | 'invalid_document'
      | 'invalid_reservation'
      | 'invalid_reservation_date'
      | 'invalid_reservation_time'
      | 'invalid_flight_details',
  ) {
    super(code);
  }
}

const reservationInclude = {
  accommodationDays: { include: { itineraryDay: { select: { date: true, id: true } } } },
  attachments: true,
  itineraryItem: { select: { customLabel: true, id: true } },
  tripPlace: { include: { place: true } },
} as const;

type ReservationRecord = Prisma.ReservationGetPayload<{ include: typeof reservationInclude }>;

function parseDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDateOnly(date) !== value) {
    throw new ReservationValidationError('invalid_reservation_date');
  }
  return date;
}

function normalizeOptional(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeTitle(value: string | undefined) {
  const title = value?.trim() ?? '';
  if (!title) throw new ReservationValidationError('invalid_reservation');
  return title;
}

function mapType(value: ReservationType | null | undefined) {
  const values = {
    accommodation: 'ACCOMMODATION',
    attraction: 'ATTRACTION',
    bus: 'BUS',
    ferry: 'FERRY',
    flight: 'FLIGHT',
    other: 'OTHER',
    rental_car: 'RENTAL_CAR',
    restaurant: 'RESTAURANT',
    tour: 'TOUR',
    train: 'TRAIN',
  } as const;
  return value ? values[value] : null;
}

function serializeType(value: string | null) {
  const values: Record<string, ReservationType> = {
    ACCOMMODATION: 'accommodation',
    ATTRACTION: 'attraction',
    BUS: 'bus',
    FERRY: 'ferry',
    FLIGHT: 'flight',
    OTHER: 'other',
    RENTAL_CAR: 'rental_car',
    RESTAURANT: 'restaurant',
    TOUR: 'tour',
    TRAIN: 'train',
  };
  return value ? (values[value] ?? null) : null;
}

function mapTimeZoneSource(value: string | null) {
  const values: Record<string, 'itinerary_item' | 'trip_place' | 'trip_reference'> = {
    ITINERARY_ITEM: 'itinerary_item',
    TRIP_PLACE: 'trip_place',
    TRIP_REFERENCE: 'trip_reference',
  };
  return value ? (values[value] ?? null) : null;
}

function reservationDocumentPath(userId: string, tripId: string, reservationId: string) {
  return `${userId}/${tripId}/${reservationId}/`;
}

async function findOwnedTrip(
  transaction: Prisma.TransactionClient,
  userId: string,
  tripId: string,
) {
  const trip = await transaction.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: { id: true, name: true, referenceTimeZone: true },
  });
  if (!trip) throw new ReservationNotFoundError('trip_not_found');
  return trip;
}

async function findTripPlace(
  transaction: Prisma.TransactionClient,
  tripId: string,
  tripPlaceId: string | null,
) {
  if (!tripPlaceId) return null;
  const tripPlace = await transaction.tripPlace.findFirst({
    where: { id: tripPlaceId, tripId },
    include: { place: true },
  });
  if (!tripPlace) throw new ReservationNotFoundError('trip_place_not_found');
  return tripPlace;
}

async function findItineraryItem(
  transaction: Prisma.TransactionClient,
  tripId: string,
  itineraryItemId: string | null,
) {
  if (!itineraryItemId) return null;
  const item = await transaction.itineraryItem.findFirst({
    where: { id: itineraryItemId, tripId },
    include: { itineraryDay: { select: { defaultTimeZone: true } } },
  });
  if (!item) throw new ReservationNotFoundError('itinerary_item_not_found');
  return item;
}

async function resolveApplicableDays(
  transaction: Prisma.TransactionClient,
  tripId: string,
  type: ReservationType | null,
  dayIds: string[] | undefined,
) {
  if (dayIds === undefined) return undefined;
  if (type !== 'accommodation') {
    if (dayIds.length) throw new ReservationValidationError('invalid_accommodation');
    return [];
  }
  const uniqueIds = [...new Set(dayIds)];
  const days = await transaction.itineraryDay.findMany({
    where: { id: { in: uniqueIds }, tripId },
    select: { id: true },
  });
  if (days.length !== uniqueIds.length)
    throw new ReservationNotFoundError('itinerary_day_not_found');
  return days.map((day) => day.id);
}

function resolveTimeZone(input: {
  itineraryItem: Awaited<ReturnType<typeof findItineraryItem>>;
  tripPlace: Awaited<ReturnType<typeof findTripPlace>>;
  tripTimeZone: string;
}) {
  const tripPlaceTimeZone = input.tripPlace?.place.customTimeZone;
  if (tripPlaceTimeZone && isValidIanaTimeZone(tripPlaceTimeZone)) {
    return { source: 'TRIP_PLACE' as const, timeZone: tripPlaceTimeZone };
  }
  const itemTimeZone =
    input.itineraryItem?.timeZone ?? input.itineraryItem?.itineraryDay?.defaultTimeZone;
  if (itemTimeZone && isValidIanaTimeZone(itemTimeZone)) {
    return { source: 'ITINERARY_ITEM' as const, timeZone: itemTimeZone };
  }
  return { source: 'TRIP_REFERENCE' as const, timeZone: input.tripTimeZone };
}

function dateTimeData(
  localDate: string | null | undefined,
  localTime: string | null | undefined,
  resolution: ReturnType<typeof resolveTimeZone>,
) {
  if (!localDate) {
    if (localTime) throw new ReservationValidationError('invalid_reservation_time');
    return {
      localDate: null,
      localTime: null,
      timeZone: null,
      timeZoneResolvedAt: null,
      timeZoneSource: null,
    };
  }
  try {
    return {
      localDate: parseDateOnly(localDate),
      localTime: localTime ? parseLocalTime(localTime) : null,
      timeZone: resolution.timeZone,
      timeZoneResolvedAt: new Date(),
      timeZoneSource: resolution.source,
    };
  } catch (error) {
    if (error instanceof ReservationValidationError) throw error;
    throw new ReservationValidationError('invalid_reservation_time');
  }
}

function costData(value: PlannedCostInput | null | undefined) {
  if (!value) return { plannedCostAmount: null, plannedCostCurrencyCode: null };
  return {
    plannedCostAmount: value.amount,
    plannedCostCurrencyCode: value.currencyCode.trim().toUpperCase(),
  };
}

const emptyFlightData = {
  flightAirline: null,
  flightArrivalAirport: null,
  flightArrivalInstant: null,
  flightArrivalLocalDate: null,
  flightArrivalLocalTime: null,
  flightArrivalTimeZone: null,
  flightDepartureAirport: null,
  flightDepartureInstant: null,
  flightDepartureLocalDate: null,
  flightDepartureLocalTime: null,
  flightDepartureTimeZone: null,
  flightGate: null,
  flightNumber: null,
  flightSeat: null,
  flightTerminal: null,
};

const emptyTransportData = {
  transportDropoffLocation: null,
  transportOperator: null,
  transportPickupLocation: null,
  transportServiceNumber: null,
};

function parseAuthoritativeInstant(value: string | null | undefined) {
  if (!value) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new ReservationValidationError('invalid_flight_details');
  }
  return instant;
}

function flightEndpointData(
  endpoint: FlightEndpointInput | null | undefined,
  prefix: 'flightDeparture' | 'flightArrival',
) {
  if (!endpoint) {
    return prefix === 'flightDeparture'
      ? {
          flightDepartureAirport: null,
          flightDepartureInstant: null,
          flightDepartureLocalDate: null,
          flightDepartureLocalTime: null,
          flightDepartureTimeZone: null,
        }
      : {
          flightArrivalAirport: null,
          flightArrivalInstant: null,
          flightArrivalLocalDate: null,
          flightArrivalLocalTime: null,
          flightArrivalTimeZone: null,
        };
  }

  const airport = normalizeOptional(endpoint.airport);
  const localDate = endpoint.localDate ?? null;
  const localTime = endpoint.localTime ?? null;
  const timeZone = normalizeOptional(endpoint.timeZone);
  const authoritativeInstant = parseAuthoritativeInstant(endpoint.authoritativeInstant);
  if ((localTime && !localDate) || (localDate && !timeZone) || (!localDate && timeZone)) {
    throw new ReservationValidationError('invalid_flight_details');
  }
  if (timeZone && !isValidIanaTimeZone(timeZone)) {
    throw new ReservationValidationError('invalid_flight_details');
  }

  try {
    const resolved =
      authoritativeInstant && timeZone
        ? formatInstantInTimeZone(authoritativeInstant, timeZone)
        : null;
    const date = resolved?.date ?? localDate;
    const time = resolved?.time ?? localTime;
    const dateValue = date ? parseDateOnly(date) : null;
    const timeValue = time ? parseLocalTime(time) : null;
    if (authoritativeInstant && (!dateValue || !timeZone)) {
      throw new ReservationValidationError('invalid_flight_details');
    }
    return prefix === 'flightDeparture'
      ? {
          flightDepartureAirport: airport,
          flightDepartureInstant: authoritativeInstant,
          flightDepartureLocalDate: dateValue,
          flightDepartureLocalTime: timeValue,
          flightDepartureTimeZone: timeZone,
        }
      : {
          flightArrivalAirport: airport,
          flightArrivalInstant: authoritativeInstant,
          flightArrivalLocalDate: dateValue,
          flightArrivalLocalTime: timeValue,
          flightArrivalTimeZone: timeZone,
        };
  } catch (error) {
    if (error instanceof ReservationValidationError) throw error;
    throw new ReservationValidationError('invalid_flight_details');
  }
}

function flightData(value: FlightDetailsInput | null | undefined, type: ReservationType | null) {
  if (type !== 'flight' || !value) return emptyFlightData;
  return {
    flightAirline: normalizeOptional(value.airline),
    ...flightEndpointData(value.departure, 'flightDeparture'),
    ...flightEndpointData(value.arrival, 'flightArrival'),
    flightGate: normalizeOptional(value.gate),
    flightNumber: normalizeOptional(value.number),
    flightSeat: normalizeOptional(value.seat),
    flightTerminal: normalizeOptional(value.terminal),
  };
}

function isStructuredTransport(type: ReservationType | null) {
  return (
    type === 'bus' ||
    type === 'ferry' ||
    type === 'other' ||
    type === 'rental_car' ||
    type === 'train'
  );
}

function transportData(
  value: TransportDetailsInput | null | undefined,
  type: ReservationType | null,
) {
  if (!isStructuredTransport(type) || !value) return emptyTransportData;
  return {
    transportDropoffLocation: normalizeOptional(value.dropoffLocation),
    transportOperator: normalizeOptional(value.operator),
    transportPickupLocation: normalizeOptional(value.pickupLocation),
    transportServiceNumber: normalizeOptional(value.serviceNumber),
  };
}

function flightDetailsFromReservation(reservation: {
  flightAirline: string | null;
  flightArrivalAirport: string | null;
  flightArrivalInstant: Date | null;
  flightArrivalLocalDate: Date | null;
  flightArrivalLocalTime: Date | null;
  flightArrivalTimeZone: string | null;
  flightDepartureAirport: string | null;
  flightDepartureInstant: Date | null;
  flightDepartureLocalDate: Date | null;
  flightDepartureLocalTime: Date | null;
  flightDepartureTimeZone: string | null;
  flightGate: string | null;
  flightNumber: string | null;
  flightSeat: string | null;
  flightTerminal: string | null;
}): FlightDetailsInput | null {
  if (
    !reservation.flightAirline &&
    !reservation.flightArrivalAirport &&
    !reservation.flightArrivalInstant &&
    !reservation.flightArrivalLocalDate &&
    !reservation.flightDepartureAirport &&
    !reservation.flightDepartureInstant &&
    !reservation.flightDepartureLocalDate &&
    !reservation.flightGate &&
    !reservation.flightNumber &&
    !reservation.flightSeat &&
    !reservation.flightTerminal
  ) {
    return null;
  }
  return {
    airline: reservation.flightAirline,
    arrival: {
      airport: reservation.flightArrivalAirport,
      authoritativeInstant: reservation.flightArrivalInstant?.toISOString() ?? null,
      localDate: reservation.flightArrivalLocalDate
        ? formatDateOnly(reservation.flightArrivalLocalDate)
        : null,
      localTime: formatLocalTime(reservation.flightArrivalLocalTime),
      timeZone: reservation.flightArrivalTimeZone,
    },
    departure: {
      airport: reservation.flightDepartureAirport,
      authoritativeInstant: reservation.flightDepartureInstant?.toISOString() ?? null,
      localDate: reservation.flightDepartureLocalDate
        ? formatDateOnly(reservation.flightDepartureLocalDate)
        : null,
      localTime: formatLocalTime(reservation.flightDepartureLocalTime),
      timeZone: reservation.flightDepartureTimeZone,
    },
    gate: reservation.flightGate,
    number: reservation.flightNumber,
    seat: reservation.flightSeat,
    terminal: reservation.flightTerminal,
  };
}

function transportDetailsFromReservation(reservation: {
  transportDropoffLocation: string | null;
  transportOperator: string | null;
  transportPickupLocation: string | null;
  transportServiceNumber: string | null;
}): TransportDetailsInput | null {
  if (
    !reservation.transportDropoffLocation &&
    !reservation.transportOperator &&
    !reservation.transportPickupLocation &&
    !reservation.transportServiceNumber
  ) {
    return null;
  }
  return {
    dropoffLocation: reservation.transportDropoffLocation,
    operator: reservation.transportOperator,
    pickupLocation: reservation.transportPickupLocation,
    serviceNumber: reservation.transportServiceNumber,
  };
}

function validateAccommodationDates(checkInDate: Date | null, checkOutDate: Date | null) {
  if (checkInDate && checkOutDate && checkOutDate < checkInDate) {
    throw new ReservationValidationError('invalid_accommodation');
  }
}

async function createDocumentUrl(supabase: SupabaseClient | null, path: string) {
  if (!supabase) return null;
  const { data, error } = await supabase.storage
    .from(RESERVATION_DOCUMENTS_BUCKET)
    .createSignedUrl(path, 60 * 60);
  return error ? null : data.signedUrl;
}

async function serializeReservation(
  reservation: ReservationRecord,
  supabase: SupabaseClient | null,
) {
  return {
    accommodationAddress: reservation.accommodationAddress,
    applicableDays: reservation.accommodationDays
      .map(({ itineraryDay }) => ({ date: formatDateOnly(itineraryDay.date), id: itineraryDay.id }))
      .toSorted((left, right) => left.date.localeCompare(right.date)),
    attachments: await Promise.all(
      reservation.attachments.map(async (attachment) => ({
        contentType: attachment.contentType,
        createdAt: attachment.createdAt.toISOString(),
        fileName: attachment.fileName,
        id: attachment.id,
        sizeBytes: attachment.sizeBytes,
        url: await createDocumentUrl(supabase, attachment.path),
      })),
    ),
    bookingReference: reservation.bookingReference,
    checkInDate: reservation.checkInDate ? formatDateOnly(reservation.checkInDate) : null,
    checkOutDate: reservation.checkOutDate ? formatDateOnly(reservation.checkOutDate) : null,
    createdAt: reservation.createdAt.toISOString(),
    id: reservation.id,
    itineraryItem: reservation.itineraryItem
      ? { id: reservation.itineraryItem.id, label: reservation.itineraryItem.customLabel }
      : null,
    localDate: reservation.localDate ? formatDateOnly(reservation.localDate) : null,
    localTime: formatLocalTime(reservation.localTime),
    flight: flightDetailsFromReservation(reservation),
    notes: reservation.notes,
    plannedCost:
      reservation.plannedCostAmount && reservation.plannedCostCurrencyCode
        ? {
            amount: reservation.plannedCostAmount.toFixed(2),
            currencyCode: reservation.plannedCostCurrencyCode.trim(),
          }
        : null,
    provider: reservation.provider,
    timeZone: reservation.timeZone,
    timeZoneSource: mapTimeZoneSource(reservation.timeZoneSource),
    title: reservation.title,
    transport: transportDetailsFromReservation(reservation),
    tripPlace: reservation.tripPlace
      ? {
          id: reservation.tripPlace.id,
          name: reservation.tripPlace.place.customName,
          placeId: reservation.tripPlace.placeId,
        }
      : null,
    type: serializeType(reservation.type),
    updatedAt: reservation.updatedAt.toISOString(),
  };
}

async function refreshAccommodationDays(
  transaction: Prisma.TransactionClient,
  tripId: string,
  dayIds: string[],
) {
  await Promise.all(
    [...new Set(dayIds)].map((dayId) => refreshDayDefaultTimeZone(transaction, tripId, dayId)),
  );
}

export async function listReservations(userId: string, tripId: string, accessToken: string | null) {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: {
      id: true,
      itineraryDays: { orderBy: { date: 'asc' }, select: { date: true, id: true } },
      itineraryItems: { orderBy: { position: 'asc' }, select: { customLabel: true, id: true } },
      name: true,
      tripPlaces: { include: { place: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!trip) throw new ReservationNotFoundError('trip_not_found');
  const reservations = await prisma.reservation.findMany({
    where: { tripId },
    include: reservationInclude,
    orderBy: [{ localDate: 'asc' }, { createdAt: 'desc' }],
  });
  const supabase = accessToken ? createAuthenticatedSupabaseClient(accessToken) : null;
  return {
    days: trip.itineraryDays.map((day) => ({ date: formatDateOnly(day.date), id: day.id })),
    itineraryItems: trip.itineraryItems.map((item) => ({ id: item.id, label: item.customLabel })),
    reservations: await Promise.all(
      reservations.map((reservation) => serializeReservation(reservation, supabase)),
    ),
    trip: { id: trip.id, name: trip.name },
    tripPlaces: trip.tripPlaces.map((tripPlace) => ({
      id: tripPlace.id,
      name: tripPlace.place.customName,
      placeId: tripPlace.placeId,
    })),
  };
}

export async function createReservation(
  userId: string,
  tripId: string,
  input: Required<Pick<ReservationInput, 'title'>> & ReservationInput,
) {
  const prisma = getPrismaClient();
  const reservationId = await prisma.$transaction(async (transaction) => {
    const trip = await findOwnedTrip(transaction, userId, tripId);
    const type = input.type ?? null;
    const tripPlace = await findTripPlace(transaction, tripId, input.tripPlaceId ?? null);
    const itineraryItem = await findItineraryItem(
      transaction,
      tripId,
      input.itineraryItemId ?? null,
    );
    const applicableDayIds = await resolveApplicableDays(
      transaction,
      tripId,
      type,
      input.applicableDayIds,
    );
    const dateTime = dateTimeData(
      input.localDate,
      input.localTime,
      resolveTimeZone({ itineraryItem, tripPlace, tripTimeZone: trip.referenceTimeZone }),
    );
    const checkInDate = input.checkInDate ? parseDateOnly(input.checkInDate) : null;
    const checkOutDate = input.checkOutDate ? parseDateOnly(input.checkOutDate) : null;
    validateAccommodationDates(checkInDate, checkOutDate);
    const structuredFlight = flightData(input.flight, type);
    const structuredTransport = transportData(input.transport, type);
    const reservation = await transaction.reservation.create({
      data: {
        accommodationAddress: normalizeOptional(input.accommodationAddress),
        bookingReference: normalizeOptional(input.bookingReference),
        checkInDate,
        checkOutDate,
        ...structuredFlight,
        itineraryItemId: itineraryItem?.id ?? null,
        localDate: dateTime.localDate,
        localTime: dateTime.localTime,
        notes: normalizeOptional(input.notes),
        ...costData(input.plannedCost),
        provider: normalizeOptional(input.provider),
        timeZone: dateTime.timeZone,
        timeZoneResolvedAt: dateTime.timeZoneResolvedAt,
        timeZoneSource: dateTime.timeZoneSource,
        title: normalizeTitle(input.title),
        tripId,
        tripPlaceId: tripPlace?.id ?? null,
        ...structuredTransport,
        type: mapType(type),
      },
    });
    if (applicableDayIds?.length) {
      await transaction.reservationAccommodationDay.createMany({
        data: applicableDayIds.map((itineraryDayId) => ({
          itineraryDayId,
          reservationId: reservation.id,
          tripId,
        })),
      });
      await refreshAccommodationDays(transaction, tripId, applicableDayIds);
    }
    return reservation.id;
  });
  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, trip: { ownerId: userId }, tripId },
    include: reservationInclude,
  });
  if (!reservation) throw new ReservationNotFoundError('reservation_not_found');
  return serializeReservation(reservation, null);
}

export async function updateReservation(
  userId: string,
  tripId: string,
  reservationId: string,
  input: ReservationInput,
) {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    const trip = await findOwnedTrip(transaction, userId, tripId);
    const current = await transaction.reservation.findFirst({
      where: { id: reservationId, tripId },
      include: { accommodationDays: { select: { itineraryDayId: true } } },
    });
    if (!current) throw new ReservationNotFoundError('reservation_not_found');
    const type = input.type === undefined ? serializeType(current.type) : input.type;
    const tripPlaceId = input.tripPlaceId === undefined ? current.tripPlaceId : input.tripPlaceId;
    const itineraryItemId =
      input.itineraryItemId === undefined ? current.itineraryItemId : input.itineraryItemId;
    const tripPlace = await findTripPlace(transaction, tripId, tripPlaceId);
    const itineraryItem = await findItineraryItem(transaction, tripId, itineraryItemId);
    const localDate =
      input.localDate === undefined
        ? current.localDate
          ? formatDateOnly(current.localDate)
          : null
        : input.localDate;
    const localTime =
      input.localTime === undefined ? formatLocalTime(current.localTime) : input.localTime;
    const checkInDate =
      input.checkInDate === undefined
        ? current.checkInDate
        : input.checkInDate
          ? parseDateOnly(input.checkInDate)
          : null;
    const checkOutDate =
      input.checkOutDate === undefined
        ? current.checkOutDate
        : input.checkOutDate
          ? parseDateOnly(input.checkOutDate)
          : null;
    validateAccommodationDates(checkInDate, checkOutDate);
    const structuredFlight = flightData(
      input.flight === undefined ? flightDetailsFromReservation(current) : input.flight,
      type,
    );
    const structuredTransport = transportData(
      input.transport === undefined ? transportDetailsFromReservation(current) : input.transport,
      type,
    );
    const shouldResolveTimeZone =
      input.localDate !== undefined ||
      input.localTime !== undefined ||
      tripPlaceId !== current.tripPlaceId ||
      itineraryItemId !== current.itineraryItemId;
    const dateTime = shouldResolveTimeZone
      ? dateTimeData(
          localDate,
          localTime,
          resolveTimeZone({ itineraryItem, tripPlace, tripTimeZone: trip.referenceTimeZone }),
        )
      : {
          localDate: current.localDate,
          localTime: current.localTime,
          timeZone: current.timeZone,
          timeZoneResolvedAt: current.timeZoneResolvedAt,
          timeZoneSource: current.timeZoneSource,
        };
    const applicableDayIds = await resolveApplicableDays(
      transaction,
      tripId,
      type,
      type === 'accommodation' ? input.applicableDayIds : [],
    );
    await transaction.reservation.update({
      where: { id: current.id },
      data: {
        ...(input.accommodationAddress !== undefined
          ? { accommodationAddress: normalizeOptional(input.accommodationAddress) }
          : {}),
        ...(input.bookingReference !== undefined
          ? { bookingReference: normalizeOptional(input.bookingReference) }
          : {}),
        ...(input.checkInDate !== undefined ? { checkInDate } : {}),
        ...(input.checkOutDate !== undefined ? { checkOutDate } : {}),
        ...structuredFlight,
        itineraryItemId: itineraryItem?.id ?? null,
        localDate: dateTime.localDate,
        localTime: dateTime.localTime,
        ...(input.notes !== undefined ? { notes: normalizeOptional(input.notes) } : {}),
        ...(input.plannedCost !== undefined ? costData(input.plannedCost) : {}),
        ...(input.provider !== undefined ? { provider: normalizeOptional(input.provider) } : {}),
        timeZone: dateTime.timeZone,
        timeZoneResolvedAt: dateTime.timeZoneResolvedAt,
        timeZoneSource: dateTime.timeZoneSource,
        ...(input.title !== undefined ? { title: normalizeTitle(input.title) } : {}),
        tripPlaceId: tripPlace?.id ?? null,
        ...structuredTransport,
        type: mapType(type),
      },
    });
    if (applicableDayIds !== undefined) {
      await transaction.reservationAccommodationDay.deleteMany({ where: { reservationId } });
      if (applicableDayIds.length) {
        await transaction.reservationAccommodationDay.createMany({
          data: applicableDayIds.map((itineraryDayId) => ({
            itineraryDayId,
            reservationId,
            tripId,
          })),
        });
      }
      await refreshAccommodationDays(transaction, tripId, [
        ...current.accommodationDays.map((day) => day.itineraryDayId),
        ...applicableDayIds,
      ]);
    } else if (type === 'accommodation' && tripPlaceId !== current.tripPlaceId) {
      await refreshAccommodationDays(
        transaction,
        tripId,
        current.accommodationDays.map((day) => day.itineraryDayId),
      );
    }
  });
  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, trip: { ownerId: userId }, tripId },
    include: reservationInclude,
  });
  if (!reservation) throw new ReservationNotFoundError('reservation_not_found');
  return serializeReservation(reservation, null);
}

export async function deleteReservation(
  userId: string,
  tripId: string,
  reservationId: string,
  accessToken: string | null,
) {
  const prisma = getPrismaClient();
  const result = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const reservation = await transaction.reservation.findFirst({
      where: { id: reservationId, tripId },
      include: { accommodationDays: { select: { itineraryDayId: true } }, attachments: true },
    });
    if (!reservation) throw new ReservationNotFoundError('reservation_not_found');
    await transaction.reservation.delete({ where: { id: reservation.id } });
    await refreshAccommodationDays(
      transaction,
      tripId,
      reservation.accommodationDays.map((day) => day.itineraryDayId),
    );
    return reservation.attachments.map((attachment) => attachment.path);
  });
  const supabase = accessToken ? createAuthenticatedSupabaseClient(accessToken) : null;
  if (supabase && result.length)
    await supabase.storage.from(RESERVATION_DOCUMENTS_BUCKET).remove(result);
}

export async function addReservationAttachment(
  userId: string,
  tripId: string,
  reservationId: string,
  input: { contentType: string; fileName: string; path: string; sizeBytes: number },
  accessToken: string | null,
) {
  if (
    !allowedDocumentTypes.has(input.contentType) ||
    input.sizeBytes < 0 ||
    input.sizeBytes > maxDocumentSize ||
    !input.fileName.trim()
  ) {
    throw new ReservationValidationError('invalid_document');
  }
  if (
    input.path.includes('..') ||
    !input.path.startsWith(reservationDocumentPath(userId, tripId, reservationId))
  ) {
    throw new ReservationValidationError('invalid_document');
  }
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const reservation = await transaction.reservation.findFirst({
      where: { id: reservationId, tripId },
    });
    if (!reservation) throw new ReservationNotFoundError('reservation_not_found');
    await transaction.reservationAttachment.create({
      data: {
        contentType: input.contentType,
        fileName: input.fileName.trim(),
        path: input.path,
        reservationId,
        sizeBytes: input.sizeBytes,
      },
    });
  });
  const attachment = await prisma.reservationAttachment.findFirst({
    where: {
      path: input.path,
      reservation: { id: reservationId, trip: { ownerId: userId }, tripId },
    },
  });
  if (!attachment) throw new ReservationNotFoundError('reservation_attachment_not_found');
  const supabase = accessToken ? createAuthenticatedSupabaseClient(accessToken) : null;
  return {
    contentType: attachment.contentType,
    createdAt: attachment.createdAt.toISOString(),
    fileName: attachment.fileName,
    id: attachment.id,
    sizeBytes: attachment.sizeBytes,
    url: await createDocumentUrl(supabase, attachment.path),
  };
}

export async function deleteReservationAttachment(
  userId: string,
  tripId: string,
  reservationId: string,
  attachmentId: string,
  accessToken: string | null,
) {
  const prisma = getPrismaClient();
  const path = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const attachment = await transaction.reservationAttachment.findFirst({
      where: { id: attachmentId, reservation: { id: reservationId, tripId } },
    });
    if (!attachment) throw new ReservationNotFoundError('reservation_attachment_not_found');
    await transaction.reservationAttachment.delete({ where: { id: attachment.id } });
    return attachment.path;
  });
  const supabase = accessToken ? createAuthenticatedSupabaseClient(accessToken) : null;
  if (supabase) await supabase.storage.from(RESERVATION_DOCUMENTS_BUCKET).remove([path]);
}
