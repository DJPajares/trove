'use client';

import { cva } from 'class-variance-authority';
import { useTranslations } from 'next-intl';

import type { EditorialImageAttribution } from '@/lib/media/editorial-images';
import { cn } from '@/lib/utils';

/**
 * Provider names are brands, so they are not translated. Anything Trove has not
 * given a display form for falls back to what the service reported.
 */
const PROVIDER_LABELS: Record<string, string> = { pexels: 'Pexels' };

const attributionVariants = cva('text-[length:var(--text-metadata)] leading-tight', {
  variants: {
    variant: {
      /**
       * Bottom-left inside the frame, in the corner a landscape photograph is
       * least likely to put its subject. The chip carries its own surface so
       * the credit reads over any photograph without a scrim dulling the whole
       * image, and it inherits the theme rather than assuming a dark one.
       */
      overlay:
        'absolute bottom-2 left-2 z-10 max-w-[calc(100%-1rem)] truncate rounded-[var(--radius-sm)] bg-background/75 px-2 py-1 text-muted-foreground shadow-[var(--shadow-control)] backdrop-blur-sm',
      /** For frames too small to carry text, credited on the row instead. */
      inline: 'text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'overlay' },
});

type MediaAttributionProps = {
  attribution: EditorialImageAttribution;
  className?: string;
  /**
   * Whether the credit links back. Set false only where an anchor cannot
   * legally live - inside a row that is itself a button - and the credit has to
   * be plain text to stay valid and keyboard-sane.
   */
  linked?: boolean;
  variant?: 'inline' | 'overlay';
};

/**
 * The credit that has to accompany every editorial photograph Trove renders.
 *
 * The photographer and the provider are real links wherever an anchor is
 * allowed, so the obligation is met by something a keyboard can reach rather
 * than by decorative text. Inside a row that is itself a button no anchor may
 * nest, and the credit degrades to plain text rather than to nothing.
 */
export function MediaAttribution({
  attribution,
  className,
  linked = true,
  variant = 'overlay',
}: Readonly<MediaAttributionProps>) {
  const t = useTranslations('media');
  const providerName = PROVIDER_LABELS[attribution.providerName] ?? attribution.providerName;

  const link = (href: string, label: string) => (chunks: React.ReactNode) =>
    linked ? (
      <a
        className="rounded-[var(--radius-xs)] underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
        href={href}
        rel="noreferrer"
        target="_blank"
        title={label}
      >
        {chunks}
      </a>
    ) : (
      <>{chunks}</>
    );

  return (
    <span
      className={cn(attributionVariants({ variant }), className)}
      data-slot="media-attribution"
      data-translucent-surface={variant === 'overlay' ? true : undefined}
    >
      {t.rich('attribution.credit', {
        photographer: link(
          attribution.photographerUrl,
          t('attribution.photographerLabel', { photographer: attribution.photographerName }),
        ),
        photographerName: attribution.photographerName,
        provider: link(
          attribution.providerPageUrl,
          t('attribution.providerLabel', { provider: providerName }),
        ),
        providerName,
      })}
    </span>
  );
}
