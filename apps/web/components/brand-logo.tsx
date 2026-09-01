import type { SVGProps } from 'react';

import { cn } from '@/lib/utils';

export type BrandPresentation = 'standalone' | 'tile';

type BrandMarkProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  presentation?: BrandPresentation;
};

/**
 * Trove's folded route: three planes for planning, travelling, and remembering,
 * ending at the terracotta point the traveller chose to keep.
 *
 * The mark is decorative in product chrome. Its surrounding live text owns the
 * accessible name, so the SVG never makes a screen reader repeat "Trove".
 */
export function BrandMark({
  className,
  presentation = 'standalone',
  ...props
}: Readonly<BrandMarkProps>) {
  const tiled = presentation === 'tile';

  return (
    <svg
      {...props}
      aria-hidden="true"
      className={cn('shrink-0', className)}
      fill="none"
      focusable="false"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      {tiled ? <rect fill="var(--brand-mark-surface)" height="64" rx="16" width="64" /> : null}
      <path
        d="M18 17h28L30 32l16 15H18"
        stroke={tiled ? 'var(--brand-mark-ink)' : 'currentColor'}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="7"
      />
      <circle cx="18" cy="47" fill="var(--brand-mark-accent)" r="4.25" />
    </svg>
  );
}

type BrandLogoProps = {
  className?: string;
  markClassName?: string;
  name: string;
  presentation?: BrandPresentation;
  showWordmark?: boolean;
  wordmarkClassName?: string;
};

/** A live-text lockup keeps the localized app name selectable and accessible. */
export function BrandLogo({
  className,
  markClassName,
  name,
  presentation = 'tile',
  showWordmark = true,
  wordmarkClassName,
}: Readonly<BrandLogoProps>) {
  return (
    <span
      aria-label={showWordmark ? undefined : name}
      className={cn('inline-flex min-w-0 items-center gap-2', className)}
      role={showWordmark ? undefined : 'img'}
    >
      <BrandMark className={markClassName} presentation={presentation} />
      {showWordmark ? (
        <span
          className={cn(
            'truncate font-semibold tracking-[-0.025em] text-foreground',
            wordmarkClassName,
          )}
        >
          {name}
        </span>
      ) : null}
    </span>
  );
}
