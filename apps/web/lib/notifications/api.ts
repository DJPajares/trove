import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export type TroveNotification = {
  actionPath: string;
  browserDeliveredAt: string | null;
  eventAt: string;
  id: string;
  kind: 'leave_by' | 'reservation_upcoming' | 'task_due';
  label: string;
  timeZone: string;
  trip: { id: string; name: string };
};

export type NotificationSettings = {
  browserEnabled: boolean;
  enabled: boolean;
};

export type NotificationsResponse = {
  notifications: TroveNotification[];
  settings: NotificationSettings;
};

export class NotificationsApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

async function notificationRequest<T>(path: string, init?: RequestInit) {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new NotificationsApiError('supabase_not_configured', 500);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new NotificationsApiError('not_authenticated', 401);

  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new NotificationsApiError('notifications_unavailable', 503);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new NotificationsApiError(
      body.code ?? `notification_request_failed_${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function fetchNotifications() {
  return notificationRequest<NotificationsResponse>('/notifications');
}

export function saveNotificationSettings(changes: Partial<NotificationSettings>) {
  return notificationRequest<{ settings: NotificationSettings }>('/notifications/preferences', {
    body: JSON.stringify(changes),
    method: 'PATCH',
  });
}

export function markNotification(
  notificationId: string,
  changes: { browserDelivered?: true; read?: true },
) {
  return notificationRequest<void>(`/notifications/${notificationId}`, {
    body: JSON.stringify(changes),
    method: 'PATCH',
  });
}

export function markAllNotificationsRead() {
  return notificationRequest<void>('/notifications/read-all', { method: 'POST' });
}

export function fetchTripNotificationPreference(tripId: string) {
  return notificationRequest<{ preference: { muted: boolean } }>(
    `/trips/${tripId}/notification-preferences`,
  );
}

export function saveTripNotificationPreference(tripId: string, muted: boolean) {
  return notificationRequest<{ preference: { muted: boolean } }>(
    `/trips/${tripId}/notification-preferences`,
    { body: JSON.stringify({ muted }), method: 'PATCH' },
  );
}
