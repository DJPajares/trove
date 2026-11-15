'use client';

import { useTranslations } from 'next-intl';

import { MediaFrame } from '@/components/media-frame';
import { landingHeroImage, landingLiveItImage } from '@/lib/media/landing-images';
import { cn } from '@/lib/utils';

/**
 * Small, still pictures of the three screens the landing page describes. They
 * are illustrations, not the product: each is hidden from assistive technology
 * because the sentence beneath it says the same thing, and their sample trip
 * lives in the copy catalogue with the rest of the page's words.
 */

const SHOT =
  'grid min-h-60 content-center rounded-[var(--radius-2xl)] border border-border-subtle bg-card p-4 shadow-[var(--shadow-control)]';

const STOPS = ['one', 'two', 'three'] as const;

/** The itinerary's Simple view: when, a numbered mark on one rail, and what. */
export function PlanPreview() {
  const t = useTranslations('landing.preview.plan');

  return (
    <div aria-hidden="true" className={SHOT} data-slot="landing-preview-plan">
      <ol className="relative before:absolute before:top-4 before:bottom-4 before:start-[calc(3.25rem+0.5rem+0.6875rem-1px)] before:w-0.5 before:rounded-full before:bg-border">
        {STOPS.map((stop, index) => (
          <li key={stop}>
            <div className="grid grid-cols-[3.25rem_1.375rem_minmax(0,1fr)] items-start gap-x-2 py-1.5">
              <span className="pt-0.5 text-right text-xs font-semibold tabular-nums">
                {t(`stops.${stop}.time`)}
              </span>
              <span className="relative z-10 grid size-[1.375rem] place-items-center rounded-full bg-primary text-[0.6875rem] font-semibold text-primary-foreground tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm leading-tight font-semibold">
                  {t(`stops.${stop}.name`)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(`stops.${stop}.place`)}
                </span>
              </span>
            </div>
            {stop === 'three' ? null : (
              <p className="ps-[calc(3.25rem+1.375rem+1rem)] text-[0.6875rem] text-muted-foreground tabular-nums">
                {t(`legs.${stop}`)}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Trip Mode's Today: what is on now, what comes next, and the way there. */
export function LivePreview() {
  const t = useTranslations('landing.preview.live');
  const row = 'grid grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-x-2 text-sm';
  const tag = 'text-[0.625rem] font-bold tracking-[0.1em] uppercase';

  return (
    <div aria-hidden="true" className={SHOT} data-slot="landing-preview-live">
      <div className="grid gap-2.5 rounded-[var(--radius-lg)] bg-surface-tint p-3.5">
        <div className={row}>
          <span className={cn(tag, 'text-brand')}>{t('now')}</span>
          <span className="min-w-0">
            <span className="block font-semibold">{t('nowName')}</span>
            <span className="block text-xs text-muted-foreground tabular-nums">
              {t('nowDetail')}
            </span>
          </span>
        </div>
        <div className={row}>
          <span className={cn(tag, 'text-muted-foreground')}>{t('next')}</span>
          <span className="min-w-0">
            <span className="block font-semibold">{t('nextName')}</span>
            <span className="block text-xs text-muted-foreground tabular-nums">
              {t('nextDetail')}
            </span>
          </span>
        </div>
        <span className="justify-self-start rounded-full bg-primary px-3 py-1.5 text-[0.8125rem] font-semibold text-primary-foreground">
          {t('action')}
        </span>
      </div>
    </div>
  );
}

/** A page of the Memories journal: two prints and a line in the journal's hand. */
export function RememberPreview() {
  const t = useTranslations('landing.preview.remember');
  const print =
    'w-[38%] border-[5px] border-b-[16px] border-paper-print bg-paper-print shadow-[0_2px_8px_rgb(0_0_0/0.18)]';

  return (
    <div aria-hidden="true" className={SHOT} data-slot="landing-preview-remember">
      <div className="flex justify-center pt-1 pb-4">
        <div className={cn(print, '-me-3 -rotate-[5deg]')}>
          <MediaFrame
            alt=""
            className="aspect-[4/5] w-full rounded-none"
            dataSlot="landing-print-media"
            sizes="10rem"
            source={{ kind: 'editorial', reference: landingLiveItImage }}
            variant="card"
          />
        </div>
        <div className={cn(print, '-translate-y-1.5 rotate-[4deg]')}>
          <MediaFrame
            alt=""
            className="aspect-[4/5] w-full rounded-none"
            dataSlot="landing-print-media"
            sizes="10rem"
            source={{ kind: 'editorial', reference: landingHeroImage }}
            variant="card"
          />
        </div>
      </div>
      <p className="text-center font-journal text-lg leading-tight font-normal italic">
        {t('quote')}
      </p>
    </div>
  );
}
