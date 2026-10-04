/**
 * The Keepsake: a T built from two parts. The bar is the whole trip, the span of
 * days a traveller plans across. The ribbon hangs beneath it like the bookmark in
 * a travel journal and marks what they keep - the place, the day, the page they
 * will come back to. No pin, plane or globe; it must read as a T at 16px and hold
 * in a single flat colour.
 *
 * Below roughly 24px the gap and the ribbon's rounded shoulders are sub-pixel, so
 * a small master fuses the two parts and thickens them for favicons and badges.
 *
 * This geometry also drives every checked-in SVG and raster export. Change it
 * here, then run `pnpm --filter @trove/web brand:generate`.
 */
export const brandMark = {
  viewBox: '0 0 64 64',
  /** What the symbol actually covers inside its 64-unit artboard. */
  live: { x: 8, y: 9, width: 48, height: 46 },
  bar: 'M11 9H53A3 3 0 0 1 56 12V18A3 3 0 0 1 53 21H11A3 3 0 0 1 8 18V12A3 3 0 0 1 11 9Z',
  ribbon: 'M26.5 23.5H37.5A1.5 1.5 0 0 1 39 25V55L32 48L25 55V25A1.5 1.5 0 0 1 26.5 23.5Z',
  /** Clear space and the lockup gap are measured in ribbon widths. */
  ribbonWidth: 14,
  small: {
    bar: 'M10 8H54A3 3 0 0 1 57 11V18.5A3 3 0 0 1 54 21.5H10A3 3 0 0 1 7 18.5V11A3 3 0 0 1 10 8Z',
    ribbon: 'M24.5 20H39.5V56L32 48.5L24.5 56Z',
  },
  /** The olive app tile. The mark sits a half unit low so it looks centred. */
  tile: { radius: 16, scale: 0.76, offsetY: 0.5 },
  faviconScale: 0.8,
  /** Keeps every visible pixel inside the launcher's 40% safe-zone radius. */
  maskableScale: 0.66,
} as const;

/**
 * Instrument Sans SemiBold (SIL OFL 1.1), outlined at wght 600 and spaced by hand:
 * the font's own kerning, tightened by 20/1000 em per pair so the r tucks under
 * the T. The wordmark never renders from a font file, so it is identical in every
 * export. Capitals are 36 units tall on a baseline at y 36; round letters
 * overshoot to 36.5.
 */
export const brandWordmark = {
  viewBox: '0 0 123.85 36.5',
  width: 123.85,
  height: 36.5,
  capHeight: 36,
  letters: [
    {
      letter: 'T',
      x: -1.4,
      path: 'M13.35 36V5.13H1.4V0H31.8V5.13H19.85V36Z',
    },
    {
      letter: 'r',
      x: 25.25,
      path: 'M3.33 36V10.5H9.48V16.67H9.67V36ZM9.67 22.7 9.02 16.65Q9.92 13.4 12.05 11.7Q14.18 10 17.22 10Q18.27 10 18.72 10.2V16.15Q18.47 16.05 18.02 16.03Q17.57 16 16.92 16Q13.25 16 11.46 17.61Q9.67 19.22 9.67 22.7Z',
    },
    {
      letter: 'o',
      x: 43.5,
      path: 'M14.93 36.5Q10.88 36.5 7.82 34.8Q4.75 33.1 3.04 30.08Q1.33 27.05 1.33 23.15Q1.33 19.23 3.05 16.28Q4.77 13.33 7.82 11.67Q10.88 10 14.93 10Q19.03 10 22.09 11.67Q25.15 13.33 26.84 16.28Q28.53 19.23 28.53 23.15Q28.53 27.05 26.83 30.08Q25.12 33.1 22.06 34.8Q19 36.5 14.93 36.5ZM14.93 31.43Q16.97 31.43 18.55 30.41Q20.13 29.38 21.05 27.52Q21.97 25.65 21.97 23.1Q21.97 19.33 19.97 17.2Q17.98 15.07 14.93 15.07Q11.9 15.07 9.9 17.22Q7.9 19.37 7.9 23.1Q7.9 25.65 8.82 27.52Q9.73 29.38 11.33 30.41Q12.92 31.43 14.93 31.43Z',
    },
    {
      letter: 'v',
      x: 71.6,
      path: 'M10.45 36 0.23 10.5H7.03L15.2 33.97H11.87L19.98 10.5H26.58L16.37 36Z',
    },
    {
      letter: 'e',
      x: 96.65,
      path: 'M14.82 36.5Q10.77 36.5 7.73 34.81Q4.7 33.12 3.02 30.12Q1.33 27.12 1.33 23.22Q1.33 19.28 3.01 16.31Q4.68 13.33 7.7 11.67Q10.72 10 14.68 10Q18.5 10 21.31 11.58Q24.12 13.17 25.66 16Q27.2 18.83 27.2 22.67Q27.2 23.37 27.16 23.97Q27.12 24.57 27.02 25.15H5.27V20.73H22.17L20.87 21.95Q20.87 18.35 19.21 16.54Q17.55 14.73 14.62 14.73Q11.38 14.73 9.53 16.94Q7.67 19.15 7.67 23.3Q7.67 27.42 9.53 29.59Q11.38 31.77 14.85 31.77Q16.87 31.77 18.35 31.01Q19.83 30.25 20.55 28.68H26.52Q25.27 32.32 22.28 34.41Q19.28 36.5 14.82 36.5Z',
    },
  ],
} as const;

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The symbol stands 1.45 cap heights tall beside the wordmark, centred on its
 * capitals, 1.3 ribbon widths away. Derived rather than written out, so the
 * React lockup and the exports cannot disagree.
 */
const lockupScale = (1.45 * brandWordmark.capHeight) / brandMark.live.height;
const lockupSymbolHeight = brandMark.live.height * lockupScale;
const lockupOverhang = (lockupSymbolHeight - brandWordmark.capHeight) / 2;
const lockupWordmarkX = (brandMark.live.width + 1.3 * brandMark.ribbonWidth) * lockupScale;

export const brandLockup = {
  width: round(lockupWordmarkX + brandWordmark.width),
  height: round(lockupSymbolHeight),
  /** Places the 64-unit symbol artboard: translate(x y) scale(scale). */
  symbol: {
    scale: Math.round(lockupScale * 10000) / 10000,
    x: round(-brandMark.live.x * lockupScale),
    y: round(-brandMark.live.y * lockupScale),
  },
  wordmark: { x: round(lockupWordmarkX), y: round(lockupOverhang) },
} as const;
