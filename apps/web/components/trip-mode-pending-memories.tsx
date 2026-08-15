'use client';

import { CloudUpload, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  discardPendingMemory,
  discardPendingMemoryPhoto,
  listPendingMemories,
  type PendingMemory,
} from '@/lib/memories/api';
import { OFFLINE_SYNC_EVENT } from '@/lib/offline/trip-store';

function previewUrls(memories: PendingMemory[]) {
  return memories.flatMap((memory) =>
    memory.photos.flatMap((photo) => (photo.previewUrl ? [photo.previewUrl] : [])),
  );
}

/**
 * Shows Memories captured on this device that have not finished syncing, with the
 * photos they still owe. Travellers can drop one before it uploads, which is the
 * only moment removing it is purely local.
 */
export function TripModePendingMemories({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('memories.pending');
  const [memories, setMemories] = useState<PendingMemory[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const objectUrls = useRef<string[]>([]);

  const refresh = useCallback(async () => {
    const next = await listPendingMemories(tripId).catch(() => []);
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current = previewUrls(next);
    setMemories(next);
  }, [tripId]);

  useEffect(() => {
    void refresh();
    window.addEventListener(OFFLINE_SYNC_EVENT, refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener(OFFLINE_SYNC_EVENT, refresh);
      window.removeEventListener('online', refresh);
    };
  }, [refresh]);

  useEffect(
    () => () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current = [];
    },
    [],
  );

  async function runAction(id: string, action: () => Promise<void>) {
    setBusyId(id);
    // Anything that already reached the server simply disappears from the refresh.
    await action().catch(() => undefined);
    setBusyId(null);
    await refresh();
  }

  if (!memories.length) return null;

  return (
    <section aria-labelledby="trip-mode-pending-memories-heading">
      <h3 className="text-sm font-semibold text-foreground" id="trip-mode-pending-memories-heading">
        {t('title')}
      </h3>
      <p className="mt-1 text-xs leading-5 text-text-subtle">{t('description')}</p>

      <ul aria-label={t('listLabel')} className="mt-2 border-y border-border">
        {memories.map((memory) => (
          <li className="border-b border-border py-4 last:border-b-0" key={memory.clientMemoryId}>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-secondary text-secondary-foreground">
                {memory.state === 'conflict' || memory.state === 'failed' ? (
                  <TriangleAlert aria-hidden="true" className="size-4" />
                ) : (
                  <CloudUpload aria-hidden="true" className="size-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{memory.note ?? t('noteFallback')}</p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  {t(`states.${memory.state}`)}
                </p>
                {memory.isHighlight ? (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-brand">
                    <Sparkles aria-hidden="true" className="size-3.5" />
                    {t('highlight')}
                  </p>
                ) : null}
              </div>
              <Button
                aria-label={t('removeMemory')}
                disabled={busyId === memory.clientMemoryId}
                onClick={() =>
                  void runAction(memory.clientMemoryId, () =>
                    discardPendingMemory(tripId, memory.clientMemoryId),
                  )
                }
                size="icon-sm"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            </div>

            {memory.photos.length ? (
              <>
                <p className="mt-3 text-xs text-text-subtle">
                  {t('photoCount', { count: memory.photos.length })}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {memory.photos.map((photo) => (
                    <li className="relative" key={photo.clientPhotoId}>
                      {photo.previewUrl ? (
                        <img
                          alt={photo.fileName}
                          className="size-16 rounded-[var(--radius-md)] object-cover"
                          src={photo.previewUrl}
                        />
                      ) : (
                        <span className="flex size-16 items-center justify-center rounded-[var(--radius-md)] bg-muted/40 px-1 text-center text-[0.625rem] leading-3 text-muted-foreground">
                          {photo.fileName}
                        </span>
                      )}
                      <Button
                        aria-label={t('removePhoto', { name: photo.fileName })}
                        className="absolute -top-1.5 -right-1.5 bg-card"
                        disabled={busyId === photo.clientPhotoId}
                        onClick={() =>
                          void runAction(photo.clientPhotoId, () =>
                            discardPendingMemoryPhoto(tripId, photo.clientPhotoId),
                          )
                        }
                        size="icon-sm"
                        variant="outline"
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
