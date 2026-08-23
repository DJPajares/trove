'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { MediaFrame } from '@/components/media-frame';
import { Button } from '@/components/ui/button';
import { landingHeroImage } from '@/lib/media/landing-images';
import { motionDuration, motionEase } from '@/lib/motion';

/**
 * The signed-out hero: an asymmetric text/photo composition rather than the
 * old centered gradient panel.
 *
 * Text, then both auth actions, then the photograph — in that fixed order on
 * every breakpoint. That keeps keyboard/tab order correct everywhere and
 * keeps the CTAs a small, constant distance below the headline regardless of
 * how tall the image renders, which is what actually keeps both actions
 * inside the initial viewport on a 390px-wide screen: `PageHeader`'s
 * `immersive` density would put them under the media column instead, and
 * `MediaFrame`'s own `hero` variant is a tall 4:5 portrait below `sm` that a
 * mobile hero can't afford alongside a title, a description and two buttons.
 * The photograph is pinned build-time data (see `lib/media/landing-images.ts`),
 * never a live resolve call, so a signed-out load costs zero provider requests.
 */
export function LandingHero() {
  const t = useTranslations('landing');
  const shouldReduceMotion = useReducedMotion();

  const reveal = (delay: number) => ({
    animate: { opacity: 1, y: 0 },
    initial: shouldReduceMotion ? false : { opacity: 0, y: 8 },
    transition: shouldReduceMotion
      ? { duration: 0 }
      : { delay, duration: motionDuration.standard, ease: motionEase },
  });

  return (
    <section
      aria-labelledby="landing-heading"
      className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-stretch lg:gap-10"
    >
      <motion.div className="flex flex-col justify-center" {...reveal(0)}>
        <h1
          className="max-w-[18ch] text-[clamp(2.125rem,7vw,3.75rem)] leading-[1.08] font-semibold tracking-[-0.03em] text-balance text-foreground"
          id="landing-heading"
        >
          {t('heroTitle')}
        </h1>
        <p className="mt-5 max-w-[62ch] text-base leading-7 text-pretty text-muted-foreground md:text-lg md:leading-8">
          {t('heroDescription')}
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            className="w-full sm:w-auto"
            nativeButton={false}
            render={<Link href="/sign-up" />}
            size="lg"
          >
            {t('heroPrimary')}
          </Button>
          <Button
            className="w-full sm:w-auto"
            nativeButton={false}
            render={<Link href="/sign-in" />}
            size="lg"
            variant="outline"
          >
            {t('heroSecondary')}
          </Button>
        </div>
      </motion.div>

      <motion.div {...reveal(shouldReduceMotion ? 0 : 0.06)}>
        <MediaFrame
          alt={t('heroImageAlt')}
          className="h-52 w-full sm:h-64 lg:h-full lg:min-h-[26rem] lg:rounded-[var(--radius-2xl)]"
          dataSlot="landing-hero-media"
          preload
          sizes="(max-width: 1023px) 100vw, 40vw"
          source={{ kind: 'editorial', reference: landingHeroImage }}
          variant="card"
        />
      </motion.div>
    </section>
  );
}
