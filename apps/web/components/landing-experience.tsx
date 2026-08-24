'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { LandingHero } from '@/components/landing-hero';
import { MediaAttribution } from '@/components/media-attribution';
import { MediaFrame } from '@/components/media-frame';
import { Button } from '@/components/ui/button';
import { landingHeroImage, landingLiveItImage } from '@/lib/media/landing-images';
import { motionDuration, motionEase } from '@/lib/motion';

const SUPPORTING_KEYS = ['saved', 'routes', 'logistics', 'expenses', 'offline'] as const;

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
 * What someone sees at `/` before they have an account. Everything here
 * describes capability Trove actually ships — there is no sample data and no
 * rendering of product UI, so nothing on this page can drift out of sync with
 * the product it is describing.
 */
export function LandingExperience() {
  const t = useTranslations('landing');

  return (
    <div className="mx-auto w-full max-w-5xl space-y-16 md:space-y-24">
      <LandingHero />

      <section aria-labelledby="landing-experiences-heading" className="space-y-8">
        <Reveal>
          <h2
            className="text-[clamp(1.5rem,4vw,2rem)] leading-tight font-semibold tracking-[-0.025em] text-pretty text-foreground"
            id="landing-experiences-heading"
          >
            {t('experiencesTitle')}
          </h2>
        </Reveal>
        <p className="-mt-4 max-w-[62ch] text-base leading-7 text-pretty text-muted-foreground">
          {t('experiencesDescription')}
        </p>

        <Reveal>
          <EditorialSection
            density="compact"
            description={t('experiences.plan.description')}
            eyebrow={t('experiences.plan.eyebrow')}
            headingId="landing-plan-heading"
            headingLevel={3}
            title={t('experiences.plan.title')}
            treatment="ruled"
          />
        </Reveal>

        <Reveal>
          <EditorialSection
            description={t('experiences.live.description')}
            eyebrow={t('experiences.live.eyebrow')}
            headingId="landing-live-heading"
            headingLevel={3}
            title={t('experiences.live.title')}
            treatment="tinted"
          >
            <MediaFrame
              alt={t('liveImageAlt')}
              className="mt-4 h-40 w-full max-w-sm sm:h-48"
              dataSlot="landing-live-media"
              sizes="(max-width: 639px) 100vw, 24rem"
              source={{ kind: 'editorial', reference: landingLiveItImage }}
              variant="card"
            />
          </EditorialSection>
        </Reveal>

        <Reveal>
          <EditorialSection
            description={t('experiences.remember.description')}
            eyebrow={t('experiences.remember.eyebrow')}
            headingId="landing-remember-heading"
            headingLevel={3}
            title={t('experiences.remember.title')}
            treatment="plain"
          />
        </Reveal>
      </section>

      <Reveal>
        <EditorialSection
          density="compact"
          headingId="landing-supporting-heading"
          title={t('alsoTitle')}
          treatment="ruled"
        >
          <ul className="mt-6 grid gap-x-8 gap-y-4 md:grid-cols-2">
            {SUPPORTING_KEYS.map((key) => (
              <li className="flex gap-3 border-t border-border pt-4" key={key}>
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-accent"
                />
                <p className="text-sm leading-6 text-pretty text-muted-foreground">
                  {t(`also.${key}`)}
                </p>
              </li>
            ))}
          </ul>
        </EditorialSection>
      </Reveal>

      <Reveal>
        <EditorialSection
          description={t('closingDescription')}
          headingId="landing-closing-heading"
          title={t('closingTitle')}
          treatment="tinted"
        >
          <Button
            className="mt-2 w-full sm:w-auto"
            nativeButton={false}
            render={<Link href="/sign-up" />}
            size="lg"
          >
            {t('closingAction')}
          </Button>
        </EditorialSection>
      </Reveal>

      {/* The page's photography, credited once at its foot rather than as a chip
          over each photograph. Both references are pinned, so this list is as
          fixed as the images it credits. */}
      <footer className="flex flex-col gap-1 border-t border-border pt-6 pb-2">
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
    </div>
  );
}
