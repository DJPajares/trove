'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { MediaFrame } from '@/components/media-frame';
import { SCRIM } from '@/components/saved/finds-cover';
import { useCoverUnderHeader } from '@/hooks/use-cover-under-header';
import { landingHeroImage } from '@/lib/media/landing-images';
import { pageEntrance } from '@/lib/page-entrance';
import { cn } from '@/lib/utils';

/**
 * Up beneath the header and out to both edges, as the landing cover is, and
 * down to the foot of the page so the screen ends on the sheet or the photo.
 */
const BLEED =
  'mx-[calc(50%-50vw)] -mt-[calc(var(--safe-top)+var(--header-height)+2rem+1px)] -mb-8 md:-mt-[calc(var(--safe-top)+var(--header-height)+3rem+1px)] md:-mb-12';
/** The page's gutter on a phone, where the greeting and the sheet run edge to edge. */
const GUTTER = 'max-md:ps-[var(--gutter-inline-start)] max-md:pe-[var(--gutter-inline-end)]';
/** How tall the photograph is on a phone: enough to set the greeting on, short enough to keep the first field on screen. */
const STRIP = 'h-[clamp(16rem,38svh,21rem)]';

type AuthShellProps = {
  children: ReactNode;
  /** The greeting set on the photograph, which is the page's heading. */
  title: ReactNode;
  /** One line under the greeting. */
  lead: string;
  /**
   * A heading for the form's own card, shown from `md` where the form sits on
   * the photograph apart from the greeting. A phone has only the greeting.
   */
  formTitle?: string;
  formDescription?: string;
};

/**
 * The shared frame for every account screen - sign in, sign up, and the
 * password and email-link steps - on the landing page's cover, so the way in
 * feels like one step on from the landing rather than a different site.
 *
 * On a phone the photograph is a strip with the greeting on it, and the form
 * sits on the sheet that rises over it. From `md` the photograph fills the
 * screen, the greeting stays on the left, and the form is a solid card on the
 * right, so the fields always sit on a plain surface.
 *
 * It reuses the landing's pinned photograph, so these pages make no provider
 * request, and, like the landing page, credits it nowhere on screen.
 */
export function AuthShell({
  children,
  formDescription,
  formTitle,
  lead,
  title,
}: Readonly<AuthShellProps>) {
  const t = useTranslations('landing');
  useCoverUnderHeader();

  return (
    <section
      aria-labelledby="auth-heading"
      className={cn(
        'relative isolate md:flex md:min-h-[100svh] md:flex-col md:justify-end md:overflow-hidden md:bg-surface-media',
        BLEED,
      )}
      data-slot="auth-cover"
    >
      <div
        className={cn(
          'absolute inset-x-0 top-0 -z-10 isolate overflow-hidden bg-surface-media md:inset-y-0',
          STRIP,
          'md:h-auto',
        )}
      >
        <MediaFrame
          alt={t('heroImageAlt')}
          className={cn('absolute inset-0 -z-20 h-full w-full rounded-none', pageEntrance.media)}
          dataSlot="auth-media"
          preload
          sizes="100vw"
          source={{ kind: 'editorial', reference: landingHeroImage }}
          variant="cover"
        />
        <div aria-hidden="true" className={SCRIM} />
      </div>

      <div
        className={cn(
          'mx-auto grid w-full max-w-5xl md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:items-end md:gap-16 md:pt-[calc(var(--safe-top)+var(--header-height)+4rem)] md:pb-16',
          'md:ps-[var(--gutter-inline-start)] md:pe-[var(--gutter-inline-end)]',
        )}
      >
        <div
          className={cn(
            'flex flex-col justify-end pb-12 text-white md:h-auto md:pb-2',
            STRIP,
            GUTTER,
            pageEntrance.rise,
          )}
        >
          <h1
            className="max-w-[12ch] font-journal text-[clamp(2.75rem,10vw,4.5rem)] leading-[0.95] font-normal tracking-[-0.01em] text-balance"
            id="auth-heading"
          >
            {title}
          </h1>
          <p className="mt-3 max-w-[36ch] text-base leading-[1.5] text-pretty text-white/90 md:text-lg">
            {lead}
          </p>
        </div>

        <div
          className={cn(
            'relative -mt-7 rounded-t-[1.75rem] bg-background pt-7 pb-8 md:mt-0 md:rounded-[var(--radius-2xl)] md:bg-card md:p-7 md:shadow-[0_24px_50px_-20px_rgb(0_0_0/0.55)]',
            GUTTER,
            pageEntrance.sheet,
          )}
          data-slot="auth-sheet"
        >
          <div className="mx-auto w-full max-w-md space-y-6 md:max-w-none">
            {formTitle ? (
              <div className="hidden md:block">
                <h2 className="text-[1.375rem] leading-tight font-semibold tracking-[-0.02em]">
                  {formTitle}
                </h2>
                {formDescription ? (
                  <p className="mt-1 text-sm leading-6 text-pretty text-muted-foreground">
                    {formDescription}
                  </p>
                ) : null}
              </div>
            ) : null}
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
