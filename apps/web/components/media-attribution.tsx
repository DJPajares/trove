'use client';

import { useTranslations } from 'next-intl';

import type { EditorialImageAttribution } from '@/lib/media/editorial-images';
import { cn } from '@/lib/utils';

/**
 * Provider names are brands, so they are not translated. Anything Trove has not
 * given a display form for falls back to what the service reported.
 */
const PROVIDER_LABELS: Record<string, string> = { pexels: 'Pexels' };

type MediaAttributionProps = {
  attribution: EditorialImageAttribution;
  className?: string;
  /**
   * Whether the credit links back. Set false only where an anchor cannot
   * legally live - inside a row that is itself a button - and the credit has to
   * be plain text to stay valid and keyboard-sane.
   */
  linked?: boolean;
};

/**
 * The credit that accompanies an editorial photograph.
 *
 * It never sits inside the photograph's own frame. A credit painted over every
 * image is a chip the reader learns to ignore and a layer every overlay above
 * it has to work around; instead each photograph is credited on the surface
 * that owns it - a place in its details view, a trip cover on the trip's own
 * screen, the landing photography in the page footer.
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
      className={cn(
        'text-[length:var(--text-metadata)] leading-tight text-muted-foreground',
        className,
      )}
      data-slot="media-attribution"
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
