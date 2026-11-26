'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { MediaFrame } from '@/components/media-frame';
import { MEASURE, SCRIM } from '@/components/saved/finds-cover';
import { Button } from '@/components/ui/button';
import { CoverArtworkCredit } from '@/components/cover-artwork-credit';
import { useCoverUnderHeader } from '@/hooks/use-cover-under-header';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import { pageEntrance } from '@/lib/page-entrance';
import { cn } from '@/lib/utils';

/**
 * Across the whole viewport and up beneath the header, as the covers inside
 * the app are. Signed out the header is sticky at every size, so its height
 * is cancelled on a phone as well as from `md`.
 */
const COVER_BLEED =
  'mx-[calc(50%-50vw)] -mt-[calc(var(--safe-top)+var(--header-height)+2rem+1px)] md:-mt-[calc(var(--safe-top)+var(--header-height)+3rem+1px)]';

/** The landing page's own measure, shared by the cover's words and the sheet. */
export const LANDING_MEASURE = 'mx-auto w-full max-w-5xl';

/**
 * The signed-out cover: the same full-width photograph and rising sheet a
 * traveller meets on every screen once they are in, so signing in feels like
 * walking further into the same place.
 *
 * The words and both ways in sit at the foot of the photograph, a constant
 * distance above the sheet, which keeps them inside the first screen on a
 * phone. The photograph is pinned build-time data (see
 * `lib/media/landing-images.ts`), never a live resolve call, so a signed-out
 * load costs zero provider requests.
 */
export function LandingHero() {
  const t = useTranslations('landing');
  useCoverUnderHeader();

  return (
    <section
      aria-labelledby="landing-heading"
      className={cn(
        'relative isolate flex min-h-[clamp(34rem,86svh,46rem)] flex-col justify-end overflow-hidden bg-surface-media text-white',
        COVER_BLEED,
      )}
      data-slot="landing-cover"
    >
      <MediaFrame
        alt={t('heroImageAlt')}
        className={cn('absolute inset-0 -z-20 h-full w-full rounded-none', pageEntrance.media)}
        dataSlot="landing-hero-media"
        preload
        sizes="100vw"
        photographicPlaceholder={dayHeaderFallback.preview}
        source={{ kind: 'local', src: dayHeaderFallback.src }}
        variant="cover"
      />
      <div aria-hidden="true" className={SCRIM} />
      <CoverArtworkCredit />

      <div className={MEASURE}>
        <div
          className={cn(
            LANDING_MEASURE,
            'pt-[calc(var(--safe-top)+var(--header-height)+4rem)] pb-20 md:pb-28',
            pageEntrance.rise,
          )}
        >
          <h1
            className="max-w-[11ch] font-journal text-[clamp(3.25rem,11vw,6.25rem)] leading-[0.92] font-normal tracking-[-0.01em] text-balance"
            id="landing-heading"
          >
            {t.rich('heroTitle', { em: (chunks) => <em>{chunks}</em> })}
          </h1>
          <p className="mt-4 max-w-[40ch] text-base leading-[1.55] text-pretty text-white/90 md:text-lg">
            {t('heroDescription')}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Button
              className="bg-white px-6 text-neutral-900 hover:bg-white/90 focus-visible:ring-white/70"
              nativeButton={false}
              render={<Link href="/sign-up" />}
              size="lg"
            >
              {t('heroPrimary')}
            </Button>
            <Link
              className="inline-flex min-h-11 items-center rounded-[var(--radius-sm)] text-[0.9375rem] font-semibold text-white/90 outline-none hover:text-white hover:underline focus-visible:ring-3 focus-visible:ring-white/70"
              href="/sign-in"
            >
              {t('heroSecondary')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
