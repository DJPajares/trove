'use client';

import {
  Bus,
  CarFront,
  Check,
  CloudDownload,
  Footprints,
  Landmark,
  Copy,
  Paperclip,
  Plane,
  Route,
  Ship,
  TrainFront,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { usePreferences } from '@/components/preferences-provider';
import { formatSuggestedClock } from '@/lib/itinerary/day-time-suggestions';
import * as Icons from '@/lib/icons';
import type { Reservation, ReservationType } from '@/lib/reservations/api';
import { arrivalDayOffset, reservationWhen, stayNights } from '@/lib/reservations/view';
import { cn } from '@/lib/utils';

const typeIcons: Record<ReservationType, LucideIcon> = {
  accommodation: Icons.DailyBase,
  attraction: Landmark,
  bus: Bus,
  ferry: Ship,
  flight: Plane,
  other: Route,
  rental_car: CarFront,
  restaurant: UtensilsCrossed,
  tour: Footprints,
  train: TrainFront,
};

/** Getting there reads dark; staying, eating and doing read in the trip's own tones. */
function tileTone(type: ReservationType | null) {
  switch (type) {
    case 'flight':
    case 'train':
    case 'bus':
    case 'ferry':
    case 'rental_car':
    case 'other':
      return 'bg-score-media-background text-score-media-brand';
    case 'accommodation':
      return 'bg-secondary text-secondary-foreground';
    case 'restaurant':
      return 'bg-accent/25 text-accent-strong';
    default:
      return 'bg-surface-sunken text-muted-foreground';
  }
}

export function ReservationTypeTile({
  className,
  type,
}: Readonly<{ className?: string; type: ReservationType | null }>) {
  const Icon = type ? typeIcons[type] : Icons.Reservations;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-[var(--radius-md)] [&_svg]:size-5',
        tileTone(type),
        className,
      )}
    >
      <Icon />
    </span>
  );
}

/**
 * A booking reference is what a traveller reads out at a desk, so it is on the
 * card itself and copies in one tap, without opening anything.
 */
export function BookingReferenceCopy({
  reference,
  tone = 'card',
}: Readonly<{ reference: string; tone?: 'card' | 'dark' }>) {
  const t = useTranslations('reservations');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      aria-label={t('copyReference', { reference })}
      className={cn(
        'relative z-10 inline-flex min-h-9 max-w-full items-center gap-2 rounded-full px-3 font-mono text-[0.8125rem] font-semibold tracking-[0.04em] outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40',
        tone === 'dark'
          ? 'bg-score-media-foreground/10 text-score-media-foreground hover:bg-score-media-foreground/15'
          : 'bg-surface-sunken text-foreground hover:bg-surface-hover',
      )}
      onClick={() =>
        void navigator.clipboard
          ?.writeText(reference)
          .then(() => setCopied(true))
          .catch(() => undefined)
      }
      type="button"
    >
      <span className="truncate">{reference}</span>
      {copied ? (
        <Check aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <Copy aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
      )}
      <span aria-live="polite" className="sr-only">
        {copied ? t('copied') : ''}
      </span>
    </button>
  );
}

/** The one line that says when, in the shape each kind of booking is read. */
export function useReservationWhenLine() {
  const t = useTranslations('reservations');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const clock = (time: string) =>
    formatSuggestedClock(time, locale, preferences.timeFormat === '12h');
  const day = (date: string) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
      weekday: 'short',
    }).format(new Date(`${date}T00:00:00.000Z`));

  return (reservation: Reservation): string | null => {
    const when = reservationWhen(reservation);
    if (reservation.type === 'accommodation') {
      const nights = stayNights(reservation);
      if (nights !== null && reservation.checkOutDate) {
        return t('stayLine', { checkOut: day(reservation.checkOutDate), count: nights });
      }
      return reservation.checkInDate
        ? t('checkInLine', { date: day(reservation.checkInDate) })
        : null;
    }
    const offset = arrivalDayOffset(when);
    const flight = reservation.type === 'flight' ? reservation.flight : null;
    const from = flight?.departure?.airport;
    const to = flight?.arrival?.airport;
    const start = [when.time ? clock(when.time) : null, from].filter(Boolean).join(' ');
    const end = [when.endTime ? clock(when.endTime) : null, to].filter(Boolean).join(' ');
    if (start && end) {
      return offset
        ? t('journeyLineNextDay', { end, offset, start })
        : t('journeyLine', { end, start });
    }
    if (reservation.type === 'rental_car' && when.endDate) {
      return t('carLine', {
        dropOff: day(when.endDate),
        pickUp: when.time ? clock(when.time) : when.date ? day(when.date) : '',
      });
    }
    return start || null;
  };
}

/**
 * One booking as it is needed on the road: what it is, when, the details that
 * identify it, and its reference ready to copy. Anything it does not have is
 * left out rather than shown empty.
 */
export function ReservationCard({
  onOpen,
  reservation,
  showDate = false,
}: Readonly<{ onOpen: () => void; reservation: Reservation; showDate?: boolean }>) {
  const t = useTranslations('reservations');
  const locale = useLocale();
  const whenLine = useReservationWhenLine()(reservation);
  const { date } = reservationWhen(reservation);
  const flight = reservation.type === 'flight' ? reservation.flight : null;
  const meta = [
    flight?.number,
    flight?.airline ?? reservation.transport?.operator ?? reservation.provider,
    reservation.tripPlace?.name,
    reservation.type === 'accommodation' ? reservation.accommodationAddress : null,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(' · ');
  const documents = reservation.attachments.length;
  const offline = reservation.attachments.some((attachment) => attachment.offlineAvailable);
  const dateLabel =
    showDate && date
      ? new Intl.DateTimeFormat(locale, {
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
          weekday: 'short',
        }).format(new Date(`${date}T00:00:00.000Z`))
      : null;

  return (
    <article className="relative flex gap-3.5 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4 shadow-[var(--shadow-surface)] transition-colors duration-[var(--motion-standard)] has-[[data-open]:hover]:bg-surface-hover has-[[data-open]:focus-visible]:ring-3 has-[[data-open]:focus-visible]:ring-ring/40">
      <ReservationTypeTile type={reservation.type} />
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="font-semibold leading-snug">
          <button
            aria-label={t('openReservation', { title: reservation.title })}
            className="text-left outline-none after:absolute after:inset-0 after:rounded-[inherit]"
            data-open
            onClick={onOpen}
            type="button"
          >
            {reservation.title}
          </button>
        </h3>
        {whenLine || dateLabel ? (
          <p className="text-sm font-medium tabular-nums text-foreground">
            {[dateLabel, whenLine].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        {meta ? <p className="truncate text-sm text-muted-foreground">{meta}</p> : null}
        {reservation.bookingReference || documents ? (
          <div className="flex flex-wrap items-center gap-2 pt-1.5">
            {reservation.bookingReference ? (
              <BookingReferenceCopy reference={reservation.bookingReference} />
            ) : null}
            {documents ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Paperclip aria-hidden="true" className="size-3.5" />
                {t('documentCount', { count: documents })}
                {offline ? (
                  <>
                    <CloudDownload
                      aria-hidden="true"
                      className="ml-1 size-3.5 text-status-success"
                    />
                    <span className="sr-only">{t('availableOffline')}</span>
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
