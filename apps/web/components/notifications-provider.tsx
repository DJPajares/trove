'use client';

import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotification,
  saveNotificationSettings,
  type NotificationSettings,
  type TroveNotification,
  NotificationsApiError,
} from '@/lib/notifications/api';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

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
  const [notifications, setNotifications] = useState<TroveNotification[]>([]);
  const [settings, setSettings] = useState<NotificationSettings>({
    browserEnabled: false,
    enabled: false,
  });
  const [status, setStatus] = useState<NotificationsStatus>('loading');
  const deliveryInFlight = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    try {
      const response = await fetchNotifications();
      setNotifications(response.notifications);
      setSettings(response.settings);
      setStatus('ready');
    } catch (error) {
      if (error instanceof NotificationsApiError && error.status === 401) {
        setNotifications([]);
        setStatus('unavailable');
        return;
      }
      setStatus((current) => (current === 'loading' ? 'error' : current));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5 * 60 * 1_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const handleRefresh = () => void refresh();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('trove-notifications-refresh', handleRefresh);

    const supabase = createBrowserSupabaseClient();
    const subscription = supabase?.auth.onAuthStateChange(() => void refresh()).data.subscription;

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
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
          setNotifications((current) =>
            current.map((item) =>
              item.id === notification.id
                ? { ...item, browserDeliveredAt: new Date().toISOString() }
                : item,
            ),
          );
        } catch {
          // Browser delivery is supplementary. In-app notifications remain available.
        } finally {
          deliveryInFlight.current.delete(notification.id);
        }
      })();
    }
  }, [notifications, settings.browserEnabled, t]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      async markAllRead() {
        const previous = notifications;
        setNotifications([]);
        try {
          await markAllNotificationsRead();
        } catch {
          setNotifications(previous);
          throw new Error('notifications_update_failed');
        }
      },
      async markRead(notificationId) {
        const previous = notifications;
        setNotifications((current) => current.filter((item) => item.id !== notificationId));
        try {
          await markNotification(notificationId, { read: true });
        } catch {
          setNotifications(previous);
          throw new Error('notification_update_failed');
        }
      },
      notifications,
      refresh,
      settings,
      status,
      async updateSettings(changes) {
        const result = await saveNotificationSettings(changes);
        setSettings(result.settings);
        if (!result.settings.enabled) setNotifications([]);
        else void refresh();
        return result.settings;
      },
    }),
    [notifications, refresh, settings, status],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used within NotificationsProvider');
  return context;
}
