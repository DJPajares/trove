'use client';

import { useEffect, useState } from 'react';

/**
 * `beforeinstallprompt` is not in the TypeScript DOM library because it is not
 * a cross-browser standard. Only the members Trove uses are declared here.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export type InstallAvailability = 'available' | 'installed' | 'unavailable';

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari reports installed PWAs here rather than through display-mode.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Holds the deferred install prompt so Trove can offer installation where the
 * user goes looking for it, instead of interrupting them with the browser's
 * prompt the moment it becomes available.
 */
export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());

    function capture(event: Event) {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setPromptEvent(null);
    }

    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const availability: InstallAvailability = installed
    ? 'installed'
    : promptEvent
      ? 'available'
      : 'unavailable';

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    // The event cannot be reused; the browser fires a fresh one if still eligible.
    setPromptEvent(null);
    if (outcome === 'accepted') setInstalled(true);
  }

  return { availability, install };
}
