import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import {
  fetchPushConfig,
  fetchPushSubscriptionStatus,
  registerPushSubscription,
  removePushSubscription,
  saveNotificationSettings,
} from '@/lib/notifications/api';
import { readPushAccount, writePushAccount } from '@/lib/notifications/push-account';

export type BackgroundPushStatus = 'configured' | 'denied' | 'off' | 'unsupported' | 'unavailable';

export function supportsBackgroundPush() {
  return (
    process.env.NODE_ENV === 'production' &&
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function vapidBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function localSubscription() {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.pushManager.getSubscription() ?? null;
}

async function activeOwnerId() {
  const supabase = createBrowserSupabaseClient();
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.user.id ?? null;
}

export async function backgroundPushStatus(browserEnabled: boolean): Promise<BackgroundPushStatus> {
  if (!supportsBackgroundPush()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const config = await fetchPushConfig().catch(() => null);
  if (!config?.available) return 'unavailable';
  if (!browserEnabled || Notification.permission !== 'granted') return 'off';
  const ownerId = await activeOwnerId().catch(() => null);
  const subscription = await localSubscription().catch(() => null);
  const markedOwner = await readPushAccount().catch(() => null);
  if (!ownerId || markedOwner !== ownerId || !subscription) return 'off';
  const status = await fetchPushSubscriptionStatus(subscription.endpoint).catch(() => null);
  return status?.registered ? 'configured' : 'off';
}

/** Called only from the traveller's setting action; permission prompts cannot
 * be launched from background effects on iOS and several desktop browsers. */
export async function enableBackgroundPush(wasEnabled: boolean) {
  if (!supportsBackgroundPush()) throw new Error('push_unsupported');
  const config = await fetchPushConfig();
  if (!config.available || !config.publicKey) throw new Error('push_unavailable');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  const ownerId = await activeOwnerId();
  if (!ownerId) throw new Error('not_authenticated');
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  const previousOwner = await readPushAccount().catch(() => null);
  if (subscription && previousOwner && previousOwner !== ownerId) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidBytes(config.publicKey),
  });
  try {
    if (!wasEnabled) await saveNotificationSettings({ browserEnabled: true });
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.auth || !json.keys.p256dh)
      throw new Error('push_invalid_subscription');
    await registerPushSubscription(json, 'en');
    await writePushAccount(ownerId);
    return true;
  } catch (error) {
    if (!wasEnabled)
      await saveNotificationSettings({ browserEnabled: false }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
    await writePushAccount(null).catch(() => undefined);
    throw error;
  }
}

export async function clearLocalPush() {
  await writePushAccount(null).catch(() => undefined);
  if (!supportsBackgroundPush()) return;
  const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  await subscription?.unsubscribe().catch(() => undefined);
  const notifications = await registration?.getNotifications().catch(() => []);
  notifications
    ?.filter((notification) => notification.tag.startsWith('trove-'))
    .forEach((notification) => notification.close());
}

export async function disableBackgroundPush() {
  await saveNotificationSettings({ browserEnabled: false });
  await clearLocalPush();
}

export async function clearPushForSignOut() {
  const subscription = supportsBackgroundPush()
    ? await localSubscription().catch(() => null)
    : null;
  if (subscription) await removePushSubscription(subscription.endpoint).catch(() => undefined);
  await clearLocalPush();
}

export async function clearPushForDifferentAccount(ownerId: string | null) {
  const markedOwner = await readPushAccount().catch(() => null);
  if (markedOwner && markedOwner !== ownerId) await clearLocalPush();
}
