'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotification,
  saveNotificationSettings,
  type NotificationSettings,
  type TroveNotification,
} from '@/lib/notifications/api';
import { apiErrorStatus } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

const NOTIFICATIONS_POLL_MS = 5 * 60 * 1_000;

const DEFAULT_SETTINGS: NotificationSettings = { browserEnabled: false, enabled: false };

type NotificationsResponse = {
  notifications: TroveNotification[];
  settings: NotificationSettings;
};

type NotificationsStatus = 'error' | 'loading' | 'ready' | 'unavailable';

type NotificationsContextValue = {
  markAllRead: () => Promise<void>;
  markRead: (notificationId: string) => Promise<void>;
  notifications: TroveNotification[];
  refresh: () => Promise<void>;
  settings: NotificationSettings;
  status: NotificationsStatus;
  updateSettings: (changes: Partial<NotificationSettings>) => Promise<NotificationSettings>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

function formatEventTime(notification: TroveNotification) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: notification.timeZone,
  }).format(new Date(notification.eventAt));
}

export function NotificationsProvider({ children }: Readonly<{ children: ReactNode }>) {
  const t = useTranslations('notifications');
  const queryClient = useQueryClient();
  const queryKey = queryKeys.notifications();
  const deliveryInFlight = useRef(new Set<string>());

  const query = useQuery({
    queryFn: fetchNotifications,
    queryKey,
    // Notifications are the one read in Trove that is genuinely time-sensitive
    // and costs nothing but a database query, so this is the only query allowed
    // a poll and a focus refetch.
    refetchInterval: NOTIFICATIONS_POLL_MS,
    refetchOnWindowFocus: true,
  });

  const notifications = query.data?.notifications ?? [];
  const settings = query.data?.settings ?? DEFAULT_SETTINGS;

  const status: NotificationsStatus = query.isPending
    ? 'loading'
    : apiErrorStatus(query.error) === 401
      ? 'unavailable'
      : query.error
        ? 'error'
        : 'ready';

  const write = useCallback(
    (update: (current: NotificationsResponse) => NotificationsResponse) => {
      queryClient.setQueryData(queryKey, (current: NotificationsResponse | undefined) =>
        current ? update(current) : current,
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  useEffect(() => {
    const handleRefresh = () => void refresh();
    window.addEventListener('trove-notifications-refresh', handleRefresh);

    const supabase = createBrowserSupabaseClient();
    // Restoring a session on load emits INITIAL_SESSION and SIGNED_IN, and a
    // token rotation emits TOKEN_REFRESHED — none of which change whose
    // notifications these are, so refetching on them just repeats the load
    // above. Only a different signed-in user is worth another request.
    let knownUserId: string | null | undefined;
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user.id ?? null;
      if (knownUserId === undefined) {
        knownUserId = userId;
        return;
      }
      if (userId === knownUserId) return;
      knownUserId = userId;
      void refresh();
    }).data.subscription;

    return () => {
      window.removeEventListener('trove-notifications-refresh', handleRefresh);
      subscription?.unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    if (
      !settings.browserEnabled ||
      typeof Notification === 'undefined' ||
      Notification.permission !== 'granted'
    ) {
      return;
    }

    for (const notification of notifications) {
      if (notification.browserDeliveredAt || deliveryInFlight.current.has(notification.id)) {
        continue;
      }
      deliveryInFlight.current.add(notification.id);
      void (async () => {
        const title = t(`kinds.${notification.kind}.title`);
        const options: NotificationOptions = {
          body: t(`kinds.${notification.kind}.body`, {
            label: notification.label,
            time: formatEventTime(notification),
            trip: notification.trip.name,
          }),
          data: { url: notification.actionPath },
          icon: '/icons/trove-192.png',
          tag: `trove-${notification.id}`,
        };

        try {
          const registration =
            'serviceWorker' in navigator
              ? await navigator.serviceWorker.getRegistration()
              : undefined;
          if (registration?.active) {
            await registration.showNotification(title, options);
          } else {
            new Notification(title, options);
          }
          await markNotification(notification.id, { browserDelivered: true });
          write((current) => ({
            ...current,
            notifications: current.notifications.map((item) =>
              item.id === notification.id
                ? { ...item, browserDeliveredAt: new Date().toISOString() }
                : item,
            ),
          }));
        } catch {
          // Browser delivery is supplementary. In-app notifications remain available.
        } finally {
          deliveryInFlight.current.delete(notification.id);
        }
      })();
    }
  }, [notifications, settings.browserEnabled, t, write]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      async markAllRead() {
        const previous = queryClient.getQueryData<NotificationsResponse>(queryKey);
        write((current) => ({ ...current, notifications: [] }));
        try {
          await markAllNotificationsRead();
        } catch {
          if (previous) queryClient.setQueryData(queryKey, previous);
          throw new Error('notifications_update_failed');
        }
      },
      async markRead(notificationId) {
        const previous = queryClient.getQueryData<NotificationsResponse>(queryKey);
        write((current) => ({
          ...current,
          notifications: current.notifications.filter((item) => item.id !== notificationId),
        }));
        try {
          await markNotification(notificationId, { read: true });
        } catch {
          if (previous) queryClient.setQueryData(queryKey, previous);
          throw new Error('notification_update_failed');
        }
      },
      notifications,
      refresh,
      settings,
      status,
      async updateSettings(changes) {
        const result = await saveNotificationSettings(changes);
        write((current) => ({
          notifications: result.settings.enabled ? current.notifications : [],
          settings: result.settings,
        }));
        if (result.settings.enabled) void refresh();
        return result.settings;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notifications, queryClient, refresh, settings, status, write],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used within NotificationsProvider');
  return context;
}
