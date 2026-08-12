import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export type ReservationType =
  | 'accommodation'
  | 'attraction'
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
  notes: string | null;
  plannedCost: { amount: string; currencyCode: string } | null;
  provider: string | null;
  timeZone: string | null;
  timeZoneSource: 'itinerary_item' | 'trip_place' | 'trip_reference' | null;
  title: string;
  tripPlace: { id: string; name: string | null; placeId: string } | null;
  type: ReservationType | null;
  updatedAt: string;
};

export type ReservationInput = {
  accommodationAddress?: string | null;
  applicableDayIds?: string[];
  bookingReference?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  itineraryItemId?: string | null;
  localDate?: string | null;
  localTime?: string | null;
  notes?: string | null;
  plannedCost?: { amount: string; currencyCode: string } | null;
  provider?: string | null;
  title?: string;
  tripPlaceId?: string | null;
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
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
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

export function fetchReservations(tripId: string) {
  return reservationRequest<ReservationsResponse>(`/trips/${tripId}/reservations`);
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

export function deleteReservationDocument(
  tripId: string,
  reservationId: string,
  attachmentId: string,
) {
  return reservationRequest<void>(
    `/trips/${tripId}/reservations/${reservationId}/attachments/${attachmentId}`,
    { method: 'DELETE' },
  );
}
