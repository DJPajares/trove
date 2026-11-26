'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { HomeSheet } from '@/components/home/home-front-door';
import { LANDING_MEASURE, LandingHero } from '@/components/landing-hero';
import {
  AiPreview,
  LivePreview,
  PlanPreview,
  RememberPreview,
} from '@/components/landing-previews';
import { Button } from '@/components/ui/button';
import * as Icons from '@/lib/icons';
import { motionDuration, motionEase } from '@/lib/motion';
import { cn } from '@/lib/utils';

const CHAPTERS = [
  { key: 'plan', Preview: PlanPreview },
  { key: 'live', Preview: LivePreview },
  { key: 'remember', Preview: RememberPreview },
] as const;

const TOWNS = ['one', 'two', 'three'] as const;
const SUPPORTING_KEYS = ['logistics', 'expenses', 'kit', 'offline'] as const;
const AI_POINTS = ['brief', 'finds', 'review'] as const;

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
 * small still of its screen with a plain description beneath it, then planning
 * with AI, then the rest of what a trip holds.
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

          <section
            aria-labelledby="landing-ai-heading"
            className="grid gap-8 rounded-[var(--radius-2xl)] bg-surface-media p-6 text-media-fallback-foreground sm:p-9 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-12 md:p-12"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-[0.12em] text-primary-on-media uppercase">
                <Icons.Ai aria-hidden="true" className="size-3.5" />
                {t('ai.kicker')}
              </p>
              <h2
                className="mt-2 max-w-[16ch] font-journal text-[clamp(2.25rem,6vw,3.5rem)] leading-[0.98] font-normal text-balance"
                id="landing-ai-heading"
              >
                {t('ai.title')}
              </h2>
              <p className="mt-4 max-w-[46ch] text-base leading-7 text-pretty opacity-85">
                {t('ai.description')}
              </p>
              <dl className="mt-6 grid gap-4">
                {AI_POINTS.map((point) => (
                  <div className="border-t border-white/15 pt-3" key={point}>
                    <dt className="font-semibold">{t(`ai.points.${point}.title`)}</dt>
                    <dd className="mt-0.5 text-[0.9375rem] leading-6 text-pretty opacity-80">
                      {t(`ai.points.${point}.description`)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <Reveal>
              <AiPreview />
            </Reveal>
          </section>

          <section aria-labelledby="landing-more-heading">
            <p className={KICKER}>{t('moreKicker')}</p>
            <h2 className={SECTION_TITLE} id="landing-more-heading">
              {t('moreTitle')}
            </h2>

            <div className="mt-7 grid gap-x-10 gap-y-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-start">
              <Reveal>
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
              </Reveal>

              <dl className="grid">
                {SUPPORTING_KEYS.map((key) => (
                  <div
                    className="grid gap-x-3 gap-y-0.5 border-t border-border py-3.5 text-[0.9375rem] leading-6 first:border-t-0 first:pt-0 min-[26rem]:grid-cols-[10rem_minmax(0,1fr)] md:first:border-t md:first:pt-3.5"
                    key={key}
                  >
                    <dt className="font-semibold">{t(`also.${key}.title`)}</dt>
                    <dd className="text-pretty text-muted-foreground">
                      {t(`also.${key}.description`)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        </div>

        {/* The way in again, on paper and across the whole width, closing the page. */}
        <section
          aria-labelledby="landing-closing-heading"
          className="mx-[calc(50%-50vw)] -mb-8 bg-paper px-[calc(50vw-50%)] py-14 md:-mb-12 md:py-20"
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
              className="mt-6 px-6"
              nativeButton={false}
              render={<Link href="/sign-up" />}
              size="lg"
            >
              {t('closingAction')}
            </Button>
          </div>
        </section>
      </HomeSheet>
    </div>
  );
}
