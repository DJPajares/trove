import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import {
  listOfflineReservationDocuments,
  removeOfflineReservationDocument,
  saveSupportingSnapshot,
  selectOfflineReservationDocument,
  setOfflineApiReachable,
} from '@/lib/offline/trip-store';
import { getOfflineAuthContext } from '@/lib/offline/trip-sync';
import {
  canUseSupportingOfflineFallback,
  readPreparedSupportingData,
} from '@/lib/offline/supporting-sync';

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

export type ReservationAttachment = {
  contentType: string;
  createdAt: string;
  fileName: string;
  id: string;
  offlineAvailable: boolean;
  offlineSelected: boolean;
  sizeBytes: number;
  url: string | null;
};

export type Reservation = {
  accommodationAddress: string | null;
  applicableDays: Array<{ date: string; id: string }>;
  attachments: ReservationAttachment[];
  bookingReference: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  createdAt: string;
  id: string;
  itineraryItem: { id: string; label: string | null } | null;
  localDate: string | null;
  localTime: string | null;
  flight: FlightDetails | null;
  notes: string | null;
  plannedCost: { amount: string; currencyCode: string } | null;
  provider: string | null;
  timeZone: string | null;
  timeZoneSource: 'itinerary_item' | 'trip_place' | 'trip_reference' | null;
  title: string;
  transport: TransportDetails | null;
  tripPlace: { id: string; name: string | null; placeId: string } | null;
  type: ReservationType | null;
  updatedAt: string;
};

export type FlightEndpoint = {
  airport: string | null;
  authoritativeInstant: string | null;
  localDate: string | null;
  localTime: string | null;
  timeZone: string | null;
};

export type FlightDetails = {
  airline: string | null;
  arrival: FlightEndpoint | null;
  departure: FlightEndpoint | null;
  gate: string | null;
  number: string | null;
  seat: string | null;
  terminal: string | null;
};

export type TransportDetails = {
  dropoffLocation: string | null;
  operator: string | null;
  pickupLocation: string | null;
  serviceNumber: string | null;
};

export type ReservationInput = {
  accommodationAddress?: string | null;
  applicableDayIds?: string[];
  bookingReference?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  flight?: FlightDetails | null;
  itineraryItemId?: string | null;
  localDate?: string | null;
  localTime?: string | null;
  notes?: string | null;
  plannedCost?: { amount: string; currencyCode: string } | null;
  provider?: string | null;
  title?: string;
  tripPlaceId?: string | null;
  transport?: TransportDetails | null;
  type?: ReservationType | null;
};

export type ReservationsResponse = {
  days: Array<{ date: string; id: string }>;
  itineraryItems: Array<{ id: string; label: string | null }>;
  reservations: Reservation[];
  trip: { id: string; name: string };
  tripPlaces: Array<{ id: string; name: string | null; placeId: string }>;
};

export class ReservationsApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';
const reservationDocumentsBucket = 'reservation-documents';
const allowedDocumentTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const maxDocumentSize = 10 * 1024 * 1024;

async function getAuthContext() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new ReservationsApiError('supabase_not_configured', 500);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new ReservationsApiError('not_authenticated', 401);
  return { accessToken: data.session.access_token, supabase, userId: data.session.user.id };
}

async function reservationRequest<T>(path: string, init?: RequestInit) {
  const { accessToken } = await getAuthContext();
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    setOfflineApiReachable(false);
    throw new ReservationsApiError('reservations_unavailable', 503);
  }
  setOfflineApiReachable(response.status < 500);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new ReservationsApiError(
      body.code ?? `reservation_request_failed_${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function withoutDocumentUrls(data: ReservationsResponse): ReservationsResponse {
  return {
    ...data,
    reservations: data.reservations.map((reservation) => ({
      ...reservation,
      attachments: reservation.attachments.map((attachment) => ({
        ...attachment,
        offlineAvailable: false,
        offlineSelected: false,
        url: null,
      })),
    })),
  };
}

async function withOfflineDocuments(
  userId: string,
  tripId: string,
  data: ReservationsResponse,
  preserveLiveUrls: boolean,
) {
  const documents = await listOfflineReservationDocuments(userId, tripId).catch(() => []);
  const byAttachment = new Map(documents.map((document) => [document.attachmentId, document]));
  return {
    ...data,
    reservations: data.reservations.map((reservation) => ({
      ...reservation,
      attachments: reservation.attachments.map((attachment) => {
        const document = byAttachment.get(attachment.id);
        return {
          ...attachment,
          offlineAvailable: Boolean(document?.blob),
          offlineSelected: Boolean(document),
          url:
            preserveLiveUrls && attachment.url
              ? attachment.url
              : document?.blob
                ? URL.createObjectURL(document.blob)
                : null,
        };
      }),
    })),
  };
}

export async function fetchReservations(tripId: string) {
  const auth = await getOfflineAuthContext();
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const stored = await readPreparedSupportingData(auth.userId, tripId, 'reservations');
    return withOfflineDocuments(auth.userId, tripId, stored, false);
  }
  try {
    const data = await reservationRequest<ReservationsResponse>(`/trips/${tripId}/reservations`);
    await saveSupportingSnapshot(auth.userId, tripId, 'reservations', withoutDocumentUrls(data));
    return withOfflineDocuments(auth.userId, tripId, data, true);
  } catch (error) {
    if (canUseSupportingOfflineFallback(error)) {
      const stored = await readPreparedSupportingData(auth.userId, tripId, 'reservations');
      return withOfflineDocuments(auth.userId, tripId, stored, false);
    }
    throw error;
  }
}

export async function setReservationDocumentOffline(
  tripId: string,
  reservationId: string,
  attachment: ReservationAttachment,
  selected: boolean,
) {
  const auth = await getOfflineAuthContext();
  if (!selected) {
    await removeOfflineReservationDocument(auth.userId, tripId, attachment.id);
    return;
  }
  if (!auth.accessToken || !attachment.url || !navigator.onLine) {
    throw new ReservationsApiError('document_offline_requires_connection', 503);
  }
  const response = await fetch(attachment.url);
  if (!response.ok) throw new ReservationsApiError('document_download_failed', response.status);
  const blob = await response.blob();
  await selectOfflineReservationDocument({
    attachmentId: attachment.id,
    blob,
    contentType: attachment.contentType,
    fileName: attachment.fileName,
    reservationId,
    savedAt: new Date().toISOString(),
    selectedAt: new Date().toISOString(),
    sizeBytes: attachment.sizeBytes,
    sourceUrl: attachment.url,
    tripId,
    userId: auth.userId,
  });
}

export function createReservation(tripId: string, input: ReservationInput) {
  return reservationRequest<{ reservation: Reservation }>(`/trips/${tripId}/reservations`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateReservation(tripId: string, reservationId: string, input: ReservationInput) {
  return reservationRequest<{ reservation: Reservation }>(
    `/trips/${tripId}/reservations/${reservationId}`,
    { body: JSON.stringify(input), method: 'PATCH' },
  );
}

export function deleteReservation(tripId: string, reservationId: string) {
  return reservationRequest<void>(`/trips/${tripId}/reservations/${reservationId}`, {
    method: 'DELETE',
  });
}

export async function uploadReservationDocument(tripId: string, reservationId: string, file: File) {
  if (!allowedDocumentTypes.has(file.type) || file.size > maxDocumentSize) {
    throw new ReservationsApiError('invalid_document', 400);
  }
  const { supabase, userId } = await getAuthContext();
  const extension = file.name.split('.').pop()?.toLowerCase() || 'file';
  const path = `${userId}/${tripId}/${reservationId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(reservationDocumentsBucket).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new ReservationsApiError('document_upload_failed', 500);
  try {
    return await reservationRequest<{ attachment: ReservationAttachment }>(
      `/trips/${tripId}/reservations/${reservationId}/attachments`,
      {
        body: JSON.stringify({
          contentType: file.type,
          fileName: file.name,
          path,
          sizeBytes: file.size,
        }),
        method: 'POST',
      },
    );
  } catch (requestError) {
    await supabase.storage.from(reservationDocumentsBucket).remove([path]);
    throw requestError;
  }
}

export async function deleteReservationDocument(
  tripId: string,
  reservationId: string,
  attachmentId: string,
) {
  const auth = await getOfflineAuthContext();
  const result = await reservationRequest<void>(
    `/trips/${tripId}/reservations/${reservationId}/attachments/${attachmentId}`,
    { method: 'DELETE' },
  );
  await removeOfflineReservationDocument(auth.userId, tripId, attachmentId).catch(() => undefined);
  return result;
}
