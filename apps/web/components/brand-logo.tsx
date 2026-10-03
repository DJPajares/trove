import type { SVGProps } from 'react';

import { brandMark, brandWordmark } from '@/lib/brand/identity';
import { cn } from '@/lib/utils';

export type BrandPresentation = 'standalone' | 'tile';

type BrandMarkProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  presentation?: BrandPresentation;
};

/**
 * Trove's collected journey, shared with the generated brand assets.
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
      viewBox={brandMark.viewBox}
      xmlns="http://www.w3.org/2000/svg"
    >
      {tiled ? (
        <rect fill="var(--brand-mark-surface)" height="64" rx={brandMark.tileRadius} width="64" />
      ) : null}
      <path
        d={brandMark.path}
        stroke={tiled ? 'var(--brand-mark-ink)' : 'currentColor'}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={brandMark.strokeWidth}
      />
      <circle
        cx={brandMark.terminal.cx}
        cy={brandMark.terminal.cy}
        fill="var(--brand-mark-accent)"
        r={brandMark.terminal.radius}
      />
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

/** Outlined lettering is decorative; localized live text owns the accessible name. */
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
        <span className={cn('inline-flex min-w-0 text-foreground', wordmarkClassName)}>
          <svg
            aria-hidden="true"
            className="h-[1.3em] w-auto max-w-full"
            fill="currentColor"
            fillRule="evenodd"
            focusable="false"
            viewBox={brandWordmark.viewBox}
            xmlns="http://www.w3.org/2000/svg"
          >
            {brandWordmark.letters.map(({ letter, offset, path }) => (
              <path d={path} key={letter} transform={`translate(${offset} 0)`} />
            ))}
          </svg>
          <span className="sr-only">{name}</span>
        </span>
      ) : null}
    </span>
  );
}
