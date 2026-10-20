'use client';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { changeTripArchive } from '@/components/trip-archive-control';

const TRIP_ID = /^[\da-f-]{36}$/i;
/** Long enough to read and reach Undo, short enough not to linger over the trips. */
const SNACKBAR_MS = 8_000;

/**
 * What archiving or restoring just did, as a snackbar: it floats above the
 * bottom bar instead of pushing the library down, offers Undo while it is
 * shown, and leaves on its own. The trip's id rides in the URL so the message
 * survives the navigation that follows the action, and is cleared once seen.
 */
export function TripArchiveFeedback() {
  const params = useSearchParams();
  const archivedId = params.get('archivedTrip');
  const restoredId = params.get('restoredTrip');
  const t = useTranslations('trips.archive');
  const client = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const archived = archivedId && TRIP_ID.test(archivedId) ? archivedId : null;
  const restored = !archived && restoredId && TRIP_ID.test(restoredId) ? restoredId : null;
  const visible = Boolean(archived || restored);

  const dismiss = () => {
    const next = new URLSearchParams(params.toString());
    next.delete('archivedTrip');
    next.delete('restoredTrip');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (!visible || pending || failed) return;
    const timer = window.setTimeout(dismiss, SNACKBAR_MS);
    return () => window.clearTimeout(timer);
    // `dismiss` reads the current URL each time; the timer only restarts on a new message.
  }, [visible, pending, failed, archived, restored]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--safe-bottom)+var(--bottom-bar-height)+0.75rem)] z-[var(--layer-notice)] flex justify-center px-4 md:bottom-6">
      <div
        className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-[var(--radius-xl)] bg-score-media-background py-2 pr-2 pl-4 text-sm text-score-media-foreground shadow-[var(--shadow-overlay)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2"
        role="status"
      >
        <p className="min-w-0 flex-1">
          {archived ? t(failed ? 'error' : 'success') : t('restored')}
        </p>
        {archived ? (
          <button
            className="min-h-11 shrink-0 rounded-full px-3 font-semibold text-score-media-brand outline-none hover:bg-score-media-foreground/10 focus-visible:ring-3 focus-visible:ring-score-media-foreground/50 disabled:opacity-60"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                await changeTripArchive(client, archived, false);
                router.replace(`/trips?restoredTrip=${archived}`, { scroll: false });
              } catch {
                setFailed(true);
              } finally {
                setPending(false);
              }
            }}
            type="button"
          >
            {t('undo')}
          </button>
        ) : (
          <Link
            className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 font-semibold text-score-media-brand outline-none hover:bg-score-media-foreground/10 focus-visible:ring-3 focus-visible:ring-score-media-foreground/50"
            href={`/trips/${restored}`}
          >
            {t('open')}
          </Link>
        )}
        <button
          aria-label={t('dismiss')}
          className="grid size-11 shrink-0 place-items-center rounded-full text-score-media-muted outline-none hover:bg-score-media-foreground/10 focus-visible:ring-3 focus-visible:ring-score-media-foreground/50"
          onClick={dismiss}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
