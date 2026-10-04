import type { SVGProps } from 'react';

import { brandLockup, brandMark, brandWordmark } from '@/lib/brand/identity';
import { cn } from '@/lib/utils';

export type BrandPresentation = 'symbol' | 'tile';
export type BrandTone = 'color' | 'mono';

const { live } = brandMark;
const symbolViewBox = `${live.x} ${live.y} ${live.width} ${live.height}`;

type BrandMarkProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  presentation?: BrandPresentation;
  /** Single-ink symbol in `currentColor`. The tile keeps its fixed colours. */
  tone?: BrandTone;
};

/**
 * The Keepsake, drawn from the same geometry as the generated brand assets.
 *
 * `symbol` is the bare mark, cropped to what it draws: an olive bar (ivory on the
 * dark ground) over the terracotta ribbon. `tile` is the app icon, identical in
 * every appearance.
 *
 * The mark is decorative in product chrome. Its surrounding live text owns the
 * accessible name, so the SVG never makes a screen reader repeat "Trove".
 */
export function BrandMark({
  className,
  presentation = 'symbol',
  tone = 'color',
  ...props
}: Readonly<BrandMarkProps>) {
  const tiled = presentation === 'tile';
  const mono = tone === 'mono' && !tiled;
  const { radius, scale, offsetY } = brandMark.tile;
  const parts = (
    <>
      <path
        d={brandMark.ribbon}
        fill={
          mono
            ? 'currentColor'
            : tiled
              ? 'var(--brand-mark-accent-on-surface)'
              : 'var(--brand-symbol-ribbon)'
        }
      />
      <path
        d={brandMark.bar}
        fill={mono ? 'currentColor' : tiled ? 'var(--brand-mark-ink)' : 'var(--brand-symbol-bar)'}
      />
    </>
  );

  return (
    <svg
      {...props}
      aria-hidden="true"
      className={cn('shrink-0', className)}
      focusable="false"
      viewBox={tiled ? brandMark.viewBox : symbolViewBox}
      xmlns="http://www.w3.org/2000/svg"
    >
      {tiled ? (
        <>
          <rect fill="var(--brand-mark-surface)" height="64" rx={radius} width="64" />
          <g transform={`translate(32 ${32 + offsetY}) scale(${scale}) translate(-32 -32)`}>
            {parts}
          </g>
        </>
      ) : (
        parts
      )}
    </svg>
  );
}

type BrandLogoProps = {
  /** Size the lockup by height; the width follows its proportions. */
  className?: string;
  name: string;
  tone?: BrandTone;
};

/**
 * The horizontal lockup as one drawing, so the symbol's size, alignment and gap
 * stay exactly as `brandLockup` defines them. The wordmark takes `currentColor`;
 * localized live text owns the accessible name.
 */
export function BrandLogo({ className, name, tone = 'color' }: Readonly<BrandLogoProps>) {
  const mono = tone === 'mono';
  const { symbol, wordmark } = brandLockup;

  return (
    <span className={cn('inline-flex shrink-0', className)}>
      <svg
        aria-hidden="true"
        className="h-full w-auto"
        focusable="false"
        viewBox={`0 0 ${brandLockup.width} ${brandLockup.height}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <g transform={`translate(${symbol.x} ${symbol.y}) scale(${symbol.scale})`}>
          <path d={brandMark.ribbon} fill={mono ? 'currentColor' : 'var(--brand-symbol-ribbon)'} />
          <path d={brandMark.bar} fill={mono ? 'currentColor' : 'var(--brand-symbol-bar)'} />
        </g>
        <g fill="currentColor" transform={`translate(${wordmark.x} ${wordmark.y})`}>
          {brandWordmark.letters.map(({ letter, path, x }) => (
            <path d={path} key={letter} transform={`translate(${x} 0)`} />
          ))}
        </g>
      </svg>
      <span className="sr-only">{name}</span>
    </span>
  );
}
