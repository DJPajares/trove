'use client';

import { Check, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { usePreferences } from '@/components/preferences-provider';
import { Slider } from '@/components/ui/slider';
import * as Icons from '@/lib/icons';
import { landingHeroImage, landingLiveItImage } from '@/lib/media/landing-images';
import { cn } from '@/lib/utils';

/**
 * Three small working pieces of Trove for the welcome tour: a day to add stops
 * to, Trip Mode's now and next at a time the traveller drags, and a journal
 * page that fills as moments are kept. They are illustrations of the product,
 * not the product: one example day, with its words in the copy catalogue, and
 * nothing here is saved or sent anywhere.
 */

/** The example day, in minutes from midnight. `base` stops are on it from the start. */
const DAY = [
  { base: true, end: 600, key: 'cafe', start: 540 },
  { base: false, end: 750, key: 'monastery', start: 630 },
  { base: true, end: 870, key: 'market', start: 780 },
  { base: false, end: 960, key: 'tram', start: 900 },
  { base: false, end: 1170, key: 'view', start: 1080 },
] as const;

type StopKey = (typeof DAY)[number]['key'];

const PANEL = 'grid gap-3 rounded-[var(--radius-2xl)] border border-border-subtle bg-card p-4';
const EXAMPLE = 'text-[0.625rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase';
const HINT = 'flex items-center gap-2 text-[0.8125rem] text-muted-foreground';

/** A clock for the example day, in the traveller's own 12- or 24-hour style. */
function useClock() {
  const locale = useLocale();
  const { preferences } = usePreferences();
  const format = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12: preferences.timeFormat === '12h',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  return (minutes: number) => format.format(new Date(Date.UTC(2000, 0, 1, 0, minutes)));
}

/** Plan it: tap a place and it joins the day, in time order, with the way there. */
export function PlanDemo() {
  const t = useTranslations('onboarding.tour.how.plan');
  const exampleT = useTranslations('onboarding.tour.how');
  const clock = useClock();
  const [added, setAdded] = useState<readonly StopKey[]>([]);
  const planned = DAY.filter((stop) => stop.base || added.includes(stop.key));
  const waiting = DAY.filter((stop) => !stop.base && !added.includes(stop.key));

  return (
    <div className="grid gap-3">
      <div className={PANEL}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[0.9375rem] font-semibold">{t('day')}</p>
          <p className={EXAMPLE}>{exampleT('example')}</p>
        </div>
        <ol className="relative before:absolute before:top-4 before:bottom-4 before:start-[calc(4rem+0.5rem+0.6875rem-1px)] before:w-0.5 before:rounded-full before:bg-border">
          {planned.map((stop, index) => (
            <li key={stop.key}>
              {index > 0 ? (
                <p className="ps-[calc(4rem+1.375rem+1rem)] text-[0.6875rem] text-muted-foreground tabular-nums">
                  {t(`stops.${stop.key}.leg`)}
                </p>
              ) : null}
              <div
                className={cn(
                  'grid grid-cols-[4rem_1.375rem_minmax(0,1fr)] items-start gap-x-2 py-1.5',
                  added.at(-1) === stop.key &&
                    'motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in motion-safe:slide-in-from-bottom-2',
                )}
              >
                <span className="pt-0.5 text-right text-xs font-semibold tabular-nums">
                  {clock(stop.start)}
                </span>
                <span className="relative z-10 grid size-[1.375rem] place-items-center rounded-full bg-primary text-[0.6875rem] font-semibold text-primary-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm leading-tight font-semibold">
                    {t(`stops.${stop.key}.name`)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`stops.${stop.key}.place`)}
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ol>
        {waiting.length ? (
          <div className="flex flex-wrap gap-1.5">
            {waiting.map((stop) => (
              <button
                aria-label={t('add', { name: t(`stops.${stop.key}.name`) })}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-dashed border-border-strong px-3 text-[0.8125rem] font-semibold outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
                key={stop.key}
                onClick={() => setAdded((current) => [...current, stop.key])}
                type="button"
              >
                <Plus aria-hidden="true" className="size-3.5" />
                {t(`stops.${stop.key}.name`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <p aria-live="polite" className={cn(HINT, added.length > 0 && 'font-semibold text-brand')}>
        {added.length > 0 ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
        {added.length === 0 ? t('hintIdle') : waiting.length ? t('hintAdded') : t('hintFull')}
      </p>
    </div>
  );
}

/** Live it: drag the time and the day answers with what is on now and next. */
export function LiveDemo() {
  const t = useTranslations('onboarding.tour.how.live');
  const planT = useTranslations('onboarding.tour.how.plan');
  const clock = useClock();
  const [time, setTime] = useState(570);
  const current = DAY.find((stop) => stop.start <= time && time < stop.end);
  const upcoming = DAY.find((stop) => stop.start > time);
  const tag = 'text-[0.625rem] font-bold tracking-[0.1em] uppercase';
  const row = 'grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-2';

  return (
    <div className="grid gap-3">
      <div className={PANEL}>
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs text-muted-foreground" id="tour-time-label">
              {t('timeLabel')}
            </p>
            <p className="text-[1.375rem] leading-none font-semibold tracking-[-0.02em] tabular-nums">
              {clock(time)}
            </p>
          </div>
          <Slider
            getAriaValueText={(_, value) => clock(value)}
            max={1200}
            min={480}
            onValueChange={(value) => setTime(Array.isArray(value) ? (value[0] ?? 570) : value)}
            step={15}
            thumbLabelledBy="tour-time-label"
            value={time}
          />
        </div>
        <div
          aria-live="polite"
          className="grid gap-2.5 rounded-[var(--radius-lg)] bg-surface-tint p-3.5"
        >
          <div className={row}>
            <span className={cn(tag, 'text-brand')}>{t('now')}</span>
            <span className="min-w-0">
              <span className="block text-[0.9375rem] leading-tight font-semibold">
                {current ? planT(`stops.${current.key}.name`) : t('free')}
              </span>
              <span className="block text-xs text-muted-foreground tabular-nums">
                {current ? t('until', { time: clock(current.end) }) : t('freeDetail')}
              </span>
            </span>
          </div>
          <div className={row}>
            <span className={cn(tag, 'text-muted-foreground')}>{t('next')}</span>
            <span className="min-w-0">
              <span className="block text-[0.9375rem] leading-tight font-semibold">
                {upcoming ? planT(`stops.${upcoming.key}.name`) : t('done')}
              </span>
              <span className="block text-xs text-muted-foreground tabular-nums">
                {upcoming
                  ? t('nextDetail', {
                      leg: planT(`stops.${upcoming.key}.leg`),
                      minutes: upcoming.start - time,
                      time: clock(upcoming.start),
                    })
                  : t('doneDetail')}
              </span>
            </span>
          </div>
          {upcoming ? (
            <span className="inline-flex items-center gap-1.5 justify-self-start rounded-full bg-primary px-3 py-1.5 text-[0.8125rem] font-semibold text-primary-foreground">
              <Icons.Directions aria-hidden="true" className="size-3.5" />
              {t('directions')}
            </span>
          ) : null}
        </div>
      </div>
      <p className={HINT}>{t('hint')}</p>
    </div>
  );
}

/** Four moments cut from the two pinned landing photographs: no provider call. */
const SHOTS = [
  { key: 'one', position: '50% 20%', reference: landingLiveItImage },
  { key: 'two', position: '18% 42%', reference: landingHeroImage },
  { key: 'three', position: '50% 82%', reference: landingLiveItImage },
  { key: 'four', position: '82% 70%', reference: landingHeroImage },
] as const;

type ShotKey = (typeof SHOTS)[number]['key'];

function shotStyle(shot: (typeof SHOTS)[number]) {
  return {
    backgroundColor: shot.reference.dominantColor ?? undefined,
    backgroundImage: `url(${shot.reference.sourceUrl}?auto=compress&cs=tinysrgb&w=480)`,
    backgroundPosition: shot.position,
    backgroundSize: '230%',
  };
}

/** Remember it: tap the moments worth keeping and the journal page fills. */
export function RememberDemo() {
  const t = useTranslations('onboarding.tour.how.remember');
  const [kept, setKept] = useState<readonly ShotKey[]>([]);
  const prints = SHOTS.filter((shot) => kept.includes(shot.key));
  const latest = kept.at(-1);

  return (
    <div className="grid gap-3">
      <div className={PANEL}>
        <div className="grid grid-cols-4 gap-2">
          {SHOTS.map((shot) => {
            const pressed = kept.includes(shot.key);
            return (
              <button
                aria-label={t('keep', { caption: t(`shots.${shot.key}`) })}
                aria-pressed={pressed}
                className={cn(
                  'relative aspect-square overflow-hidden rounded-[var(--radius-md)] border-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  pressed ? 'border-primary' : 'border-transparent',
                )}
                key={shot.key}
                onClick={() =>
                  setKept((current) =>
                    current.includes(shot.key)
                      ? current.filter((key) => key !== shot.key)
                      : [...current, shot.key],
                  )
                }
                style={shotStyle(shot)}
                type="button"
              >
                {pressed ? (
                  <span className="absolute end-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check aria-hidden="true" className="size-3" strokeWidth={3} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="grid min-h-40 content-center justify-items-center gap-2 rounded-[var(--radius-lg)] bg-paper p-3.5 text-center">
          <p className={EXAMPLE}>{t('page')}</p>
          {prints.length ? (
            <>
              <div className="flex justify-center py-1">
                {prints.map((shot, index) => (
                  <span
                    className={cn(
                      '-mx-1.5 block aspect-[4/5] w-16 border-4 border-b-[13px] border-paper-print shadow-[0_2px_8px_rgb(0_0_0/0.2)] motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in motion-safe:zoom-in-95',
                      index % 2 ? 'rotate-[4deg]' : '-rotate-[5deg]',
                    )}
                    key={shot.key}
                    style={shotStyle(shot)}
                  />
                ))}
              </div>
              {latest ? (
                <p className="font-journal text-[1.0625rem] leading-tight font-normal italic">
                  {t('quote', { caption: t(`shots.${latest}`) })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          )}
        </div>
      </div>
      <p aria-live="polite" className={cn(HINT, prints.length > 0 && 'font-semibold text-brand')}>
        {prints.length > 0 ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
        {prints.length ? t('kept', { count: prints.length }) : t('hint')}
      </p>
    </div>
  );
}
