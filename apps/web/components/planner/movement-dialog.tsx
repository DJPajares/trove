'use client';
import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { MovementInput, MovementProposal, MovementSlot } from '@trove/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TimeInput } from '@/components/time-input';
import { Input } from '@/components/ui/input';
import { usePreferences } from '@/components/preferences-provider';
import { formatSuggestedClock } from '@/lib/itinerary/day-time-suggestions';

export function MovementDialog({
  proposal,
  input,
  busy,
  offline,
  error,
  nameFor,
  onCancel,
  onAccept,
  onPreview,
  finalFocus,
}: Readonly<{
  proposal: MovementProposal;
  input: MovementInput;
  busy: boolean;
  offline: boolean;
  error: string | null;
  nameFor: (id: string) => string;
  finalFocus?: () => HTMLElement | null;
  onCancel: () => void;
  onAccept: () => void;
  onPreview: (input: MovementInput) => void;
}>) {
  const id = useId();
  const t = useTranslations('itinerary.movement');
  const issueT = useTranslations('itinerary.connectedTiming.issue');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const [draft, setDraft] = useState<
    Record<string, { localTime: string; durationMinutes: string }>
  >({});
  const dirty = Object.keys(draft).length > 0;
  const clock = (time: string) =>
    formatSuggestedClock(time, locale, preferences.timeFormat === '12h');
  const dateLabel = (date: string | null) =>
    date
      ? new Intl.DateTimeFormat(locale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(date))
      : t('unscheduled');
  const zoneLabel = (s: MovementSlot) => {
    if (!s.timeZone) return '';
    const offset = s.startInstant
      ? new Intl.DateTimeFormat(locale, { timeZone: s.timeZone, timeZoneName: 'shortOffset' })
          .formatToParts(new Date(s.startInstant))
          .find((p) => p.type === 'timeZoneName')?.value
      : null;
    return ` (${s.timeZone}${offset ? `, ${offset}` : ''})`;
  };
  const range = (s: MovementSlot) =>
    `${dateLabel(s.date)} · ${s.localTime ? `${clock(s.localTime)}${s.localEndTime ? `–${clock(s.localEndTime)}` : ''}` : t('untimed')}${zoneLabel(s)}`;
  const days = [...new Set(proposal.changes.map((c) => c.after.date))];
  function preview() {
    if (busy || offline || !dirty) return;
    const overrides = new Map(input.overrides.map((o) => [o.itemId, o]));
    for (const [itemId, row] of Object.entries(draft))
      overrides.set(itemId, {
        itemId,
        localTime: row.localTime,
        ...(row.durationMinutes ? { durationMinutes: Number(row.durationMinutes) } : {}),
      });
    onPreview({ ...input, overrides: [...overrides.values()] });
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent finalFocus={finalFocus} closeLabel={t('cancel')} showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {offline ? (
          <p role="status" className="text-sm">
            {t('offline')}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        ) : null}
        {days.map((date) => (
          <section key={date ?? 'unscheduled'} className="space-y-2">
            <h3 className="text-sm font-semibold">{dateLabel(date)}</h3>
            <ul className="divide-y">
              {proposal.changes
                .filter((c) => c.after.date === date)
                .map((change) => (
                  <li className="py-2" key={change.itemId}>
                    <p className="text-sm font-medium">{nameFor(change.itemId)}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {t('before', { range: range(change.before) })}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {t('after', { range: range(change.after) })}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {change.reasons.map((reason) => t(`reason.${reason}`)).join(' ')}
                    </p>
                  </li>
                ))}
            </ul>
          </section>
        ))}
        {proposal.issues.length ? (
          <ul className="space-y-2">
            {proposal.issues.map((issue, n) => (
              <li
                key={`${issue.itemId}:${issue.code}:${n}`}
                className={
                  issue.blocking ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
                }
              >
                {nameFor(issue.itemId)}: {issueT(issue.code)}
              </li>
            ))}
          </ul>
        ) : null}
        {proposal.limitations.length ? (
          <p className="text-sm text-muted-foreground">
            {proposal.limitations.map((code) => t(`limitation.${code}`)).join(' ')}
          </p>
        ) : null}
        {proposal.status !== 'ready' ? (
          <p role="status" className="text-sm">
            {t('resolve')}
          </p>
        ) : null}
        {proposal.editable.length ? (
          <details open={proposal.status !== 'ready' || dirty} className="space-y-3">
            <summary className="cursor-pointer text-sm font-medium">{t('adjust')}</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                preview();
              }}
              className="space-y-4"
            >
              {proposal.editable.map((row) => {
                const value = draft[row.itemId] ?? {
                  localTime: row.localTime ?? '',
                  durationMinutes: row.durationMinutes?.toString() ?? '',
                };
                const edit = (patch: Partial<typeof value>) =>
                  setDraft((current) => ({ ...current, [row.itemId]: { ...value, ...patch } }));
                return (
                  <fieldset key={row.itemId} disabled={busy} className="space-y-2">
                    <legend className="text-sm font-medium">{nameFor(row.itemId)}</legend>
                    <label className="block text-xs" htmlFor={`${id}-${row.itemId}`}>
                      {t('start')}
                    </label>
                    <TimeInput
                      id={`${id}-${row.itemId}`}
                      value={value.localTime}
                      required={Boolean(draft[row.itemId])}
                      onValueChange={(localTime) => edit({ localTime })}
                    />
                    {row.durationMinutes == null ? (
                      <label className="block text-xs">
                        {t('duration')}
                        <Input
                          type="number"
                          min={1}
                          max={1440}
                          value={value.durationMinutes}
                          required={Boolean(draft[row.itemId])}
                          onChange={(e) => edit({ durationMinutes: e.target.value })}
                        />
                      </label>
                    ) : null}
                  </fieldset>
                );
              })}
              <Button type="submit" variant="outline" disabled={busy || offline || !dirty}>
                {t('preview')}
              </Button>
            </form>
          </details>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={busy || offline || dirty || proposal.status !== 'ready'}
            onClick={onAccept}
          >
            {t(busy ? 'working' : 'accept')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
