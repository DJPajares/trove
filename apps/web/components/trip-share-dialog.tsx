'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { updateTripVisibility, type Trip } from '@/lib/trips/api';

type TripShareDialogProps = {
  onOpenChange: (open: boolean) => void;
  onTripChange: (trip: Trip) => void;
  open: boolean;
  trip: Trip;
};

/**
 * The one place a trip becomes readable by people without accounts.
 *
 * A switch rather than a Copy-link button that quietly publishes: turning a trip
 * public is a consequential change, so it is the thing the traveller does, and
 * the link only appears once they have done it. The line naming what the link
 * carries sits next to the switch for the same reason - the moment to learn that
 * notes travel with a plan is before sending it, not after.
 */
export function TripShareDialog({
  onOpenChange,
  onTripChange,
  open,
  trip,
}: Readonly<TripShareDialogProps>) {
  const t = useTranslations('trips.share');
  const switchId = useId();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const isPublic = trip.visibility === 'public';
  // Rendered rather than stored, so it follows the deployment the owner is on
  // rather than whatever origin was baked in at build time.
  const [shareUrl, setShareUrl] = useState('');

  useEffect(() => {
    setShareUrl(`${window.location.origin}/shared/${trip.id}`);
  }, [trip.id]);

  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  /**
   * A direct write rather than a queued one. The offline mutation queue exists
   * so a traveller can keep planning on a plane, and publishing a trip is not
   * something to replay hours later against a decision they may have changed
   * their mind about - a share toggle that has not reached the server has not
   * shared anything, and should say so rather than pretend.
   */
  async function setVisibility(next: 'private' | 'public') {
    setSaving(true);
    setSaveFailed(false);
    try {
      const result = await updateTripVisibility(trip.id, next);
      onTripChange(result.trip);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  // A link copied from a trip that has since been made private would be a link
  // to nothing, so the confirmation does not outlive the state it confirmed.
  useEffect(() => {
    setCopied(false);
    setCopyFailed(false);
  }, [isPublic]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      // Clipboard access is refusable and absent over plain HTTP. The field is
      // selectable, so the fallback is telling the traveller to use it.
      setCopyFailed(true);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor={switchId}>{t('toggleLabel')}</Label>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{t('carries')}</p>
            </div>
            <Switch
              checked={isPublic}
              disabled={saving}
              id={switchId}
              onCheckedChange={(checked) => void setVisibility(checked ? 'public' : 'private')}
            />
          </div>

          {saving ? (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {t('saving')}
            </p>
          ) : null}
          {saveFailed ? (
            <p className="text-sm text-destructive" role="alert">
              {t('saveFailed')}
            </p>
          ) : null}

          {isPublic ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${switchId}-link`}>{t('linkLabel')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  className="font-mono text-xs"
                  id={`${switchId}-link`}
                  onFocus={(event) => event.currentTarget.select()}
                  readOnly
                  value={shareUrl}
                />
                <Button
                  aria-label={t('copy')}
                  onClick={() => void copyLink()}
                  size="sm"
                  variant="secondary"
                >
                  {copied ? (
                    <Check aria-hidden="true" data-icon="inline-start" />
                  ) : (
                    <Copy aria-hidden="true" data-icon="inline-start" />
                  )}
                  {copied ? t('copied') : t('copy')}
                </Button>
              </div>
              {copyFailed ? (
                <p className="text-sm text-destructive" role="alert">
                  {t('copyFailed')}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button size="sm" variant="secondary">
                {t('close')}
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
