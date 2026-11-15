'use client';

import { useTranslations } from 'next-intl';

import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import { cn } from '@/lib/utils';

/**
 * A small credit for Trove's own cover artwork, set in the photograph's lower
 * right corner wherever a cover shows it.
 *
 * Its default sits just above the sheet that rises over a cover, so the sheet
 * never hides it; a cover without a sheet passes its own offset. Kept quiet -
 * small, light type on the scrim - because it is a courtesy, not the content.
 */
export function CoverArtworkCredit({ className }: Readonly<{ className?: string }>) {
  const t = useTranslations('media.attribution');
  const { photographerName, photographerUrl, providerPageUrl } = dayHeaderFallback.attribution;

  const link = (href: string) => (chunks: React.ReactNode) => (
    <a
      className="rounded-[var(--radius-xs)] outline-none hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-white/70"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {chunks}
    </a>
  );

  return (
    <p
      className={cn(
        'pointer-events-auto absolute end-[max(0.75rem,var(--gutter-inline-end))] bottom-10 z-10 text-[0.625rem] leading-none text-white/65 md:bottom-13',
        className,
      )}
      data-slot="cover-artwork-credit"
    >
      {t.rich('credit', {
        photographer: link(photographerUrl),
        photographerName,
        provider: link(providerPageUrl),
        providerName: 'Pexels',
      })}
    </p>
  );
}
