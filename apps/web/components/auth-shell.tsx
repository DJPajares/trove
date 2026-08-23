import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { MediaFrame } from '@/components/media-frame';
import { landingHeroImage } from '@/lib/media/landing-images';

type AuthShellProps = {
  children: ReactNode;
  headingId: string;
};

/**
 * Shared visual frame for sign-in and sign-up: the same asymmetric photo
 * treatment as the landing hero, so auth reads as a continuation of the
 * landing rather than a marketing page handing off to a bare form.
 *
 * The photo is `hidden lg:block`. Unlike the landing hero, these are
 * task-completion screens where the form has to stay the unambiguous focus
 * on a small viewport, and mobile is Trove's primary design reference. It
 * reuses the same pinned `landingHeroImage` reference the hero uses, so no
 * third photograph needs curating or attributing.
 */
export function AuthShell({ children, headingId }: Readonly<AuthShellProps>) {
  const t = useTranslations('landing');

  return (
    <section
      aria-labelledby={headingId}
      className="grid min-h-[calc(100dvh-12rem)] items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
    >
      <div className="hidden lg:block">
        <MediaFrame
          alt={t('heroImageAlt')}
          className="h-full min-h-[28rem] w-full rounded-[var(--radius-2xl)]"
          dataSlot="auth-media"
          sizes="35vw"
          source={{ kind: 'editorial', reference: landingHeroImage }}
          variant="card"
        />
      </div>
      <div className="mx-auto w-full max-w-md">{children}</div>
    </section>
  );
}
