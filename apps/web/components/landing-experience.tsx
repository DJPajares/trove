'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { HomeSheet } from '@/components/home/home-front-door';
import { LANDING_MEASURE, LandingHero } from '@/components/landing-hero';
import { LivePreview, PlanPreview, RememberPreview } from '@/components/landing-previews';
import { MediaAttribution } from '@/components/media-attribution';
import { Button } from '@/components/ui/button';
import { landingHeroImage, landingLiveItImage } from '@/lib/media/landing-images';
import { motionDuration, motionEase } from '@/lib/motion';
import { cn } from '@/lib/utils';

const CHAPTERS = [
  { key: 'plan', Preview: PlanPreview },
  { key: 'live', Preview: LivePreview },
  { key: 'remember', Preview: RememberPreview },
] as const;

const TOWNS = ['one', 'two', 'three'] as const;
const SUPPORTING_KEYS = ['logistics', 'expenses', 'kit', 'offline'] as const;

const KICKER = 'text-[0.6875rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase';
const SECTION_TITLE =
  'mt-2 max-w-[18ch] font-journal text-[clamp(2rem,5.5vw,3rem)] leading-none font-normal text-balance';
const PANEL = 'grid min-w-0 content-start gap-3 rounded-[var(--radius-2xl)] p-5 sm:p-7';
const PANEL_TITLE = 'font-journal text-[clamp(1.625rem,4vw,2.125rem)] leading-[1.05] font-normal';

/** A restrained, one-shot reveal as a section first enters the viewport. */
function Reveal({ children }: Readonly<{ children: ReactNode }>) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { duration: motionDuration.standard, ease: motionEase }
      }
      viewport={{ margin: '-80px', once: true }}
      whileInView={{ opacity: 1, y: 0 }}
    >
      {children}
    </motion.div>
  );
}

/**
 * What someone sees at `/` before they have an account: the cover and rising
 * sheet they will meet inside, then the trip's three chapters, each shown as a
 * small still of its screen with one sentence beneath it.
 *
 * The stills are illustrations with their own sample trip in the copy
 * catalogue. They show only capability Trove ships, and reach for no provider:
 * every photograph on the page is pinned build-time data.
 */
export function LandingExperience() {
  const t = useTranslations('landing');

  return (
    <div data-slot="landing">
      <LandingHero />

      <HomeSheet>
        <div className={cn(LANDING_MEASURE, 'space-y-14 pt-2 md:space-y-20')}>
          <section aria-labelledby="landing-chapters-heading">
            <p className={KICKER}>{t('chaptersKicker')}</p>
            <h2 className={SECTION_TITLE} id="landing-chapters-heading">
              {t('chaptersTitle')}
            </h2>
            <ol className="mt-7 grid gap-x-5 gap-y-9 md:grid-cols-3">
              {CHAPTERS.map(({ key, Preview }) => (
                <li className="min-w-0" key={key}>
                  <Reveal>
                    <Preview />
                    <p
                      className={cn(
                        'mt-4 text-[0.6875rem] font-bold tracking-[0.14em] uppercase',
                        key === 'remember' ? 'text-accent-strong' : 'text-brand',
                      )}
                    >
                      {t(`chapters.${key}.eyebrow`)}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold tracking-[-0.015em]">
                      {t(`chapters.${key}.title`)}
                    </h3>
                    <p className="mt-1 text-[0.9375rem] leading-6 text-pretty text-muted-foreground">
                      {t(`chapters.${key}.description`)}
                    </p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="landing-head-start-heading">
            <p className={KICKER}>{t('headStartKicker')}</p>
            <h2 className={SECTION_TITLE} id="landing-head-start-heading">
              {t('headStartTitle')}
            </h2>

            <Reveal>
              <div className="mt-7 grid gap-5 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <div className={cn(PANEL, 'bg-surface-media text-media-fallback-foreground')}>
                  <h3 className={PANEL_TITLE}>{t('draft.title')}</h3>
                  <p
                    aria-hidden="true"
                    className="rounded-[var(--radius-lg)] border border-white/15 bg-white/8 px-3.5 py-3 text-[0.9375rem] leading-6"
                  >
                    <span className="mb-1 block text-[0.6875rem] font-semibold tracking-[0.1em] uppercase opacity-65">
                      {t('draft.promptLabel')}
                    </span>
                    {t('draft.prompt')}
                  </p>
                  <p className="max-w-[44ch] text-[0.9375rem] leading-6 text-pretty opacity-85">
                    {t('draft.description')}
                  </p>
                </div>

                <div className={cn(PANEL, 'bg-paper')}>
                  <h3 className={PANEL_TITLE}>{t('finds.title')}</h3>
                  <p className="max-w-[44ch] text-[0.9375rem] leading-6 text-pretty text-muted-foreground">
                    {t('finds.description')}
                  </p>
                  <ul aria-hidden="true" className="grid gap-2">
                    {TOWNS.map((town) => (
                      <li
                        className="flex items-baseline justify-between gap-3 rounded-[var(--radius-lg)] border border-border-subtle bg-card px-3 py-2 text-[0.9375rem]"
                        key={town}
                      >
                        <span className="font-semibold">{t(`finds.towns.${town}.name`)}</span>
                        <span className="text-[0.8125rem] text-muted-foreground tabular-nums">
                          {t(`finds.towns.${town}.count`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Reveal>

            <dl className="mt-7 grid gap-x-8 sm:grid-cols-2">
              {SUPPORTING_KEYS.map((key) => (
                <div
                  className="grid gap-x-3 gap-y-0.5 border-t border-border py-3.5 text-[0.9375rem] leading-6 min-[26rem]:grid-cols-[9rem_minmax(0,1fr)]"
                  key={key}
                >
                  <dt className="font-semibold">{t(`also.${key}.title`)}</dt>
                  <dd className="text-pretty text-muted-foreground">
                    {t(`also.${key}.description`)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        {/* The way in again, on paper and across the whole width. */}
        <section
          aria-labelledby="landing-closing-heading"
          className="mx-[calc(50%-50vw)] bg-paper px-[calc(50vw-50%)] py-14 md:py-20"
        >
          <div className={LANDING_MEASURE}>
            <h2
              className="max-w-[14ch] font-journal text-[clamp(2.5rem,7vw,4rem)] leading-[0.98] font-normal text-balance"
              id="landing-closing-heading"
            >
              {t('closingTitle')}
            </h2>
            <p className="mt-3 max-w-[46ch] text-base leading-7 text-pretty text-muted-foreground">
              {t('closingDescription')}
            </p>
            <Button
              className="mt-6 rounded-full px-6"
              nativeButton={false}
              render={<Link href="/sign-up" />}
              size="lg"
            >
              {t('closingAction')}
            </Button>
          </div>
        </section>

        {/* The page's photography, credited once at its foot rather than as a chip
            over each photograph. Both references are pinned, so this list is as
            fixed as the images it credits. */}
        <footer className={cn(LANDING_MEASURE, 'flex flex-col gap-1 pb-2')}>
          <h2 className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-text-subtle uppercase">
            {t('photographyTitle')}
          </h2>
          {[landingHeroImage, landingLiveItImage].map((reference) => (
            <MediaAttribution
              attribution={reference.attribution}
              key={reference.attribution.providerPageUrl}
            />
          ))}
        </footer>
      </HomeSheet>
    </div>
  );
}
