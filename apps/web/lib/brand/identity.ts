/**
 * The collected journey: a continuous ribbon turns through three broad curves
 * and gathers around the moment the traveller keeps. No lettering is hidden in
 * the symbol; it must hold its identity in a single colour.
 *
 * This geometry also drives every checked-in SVG and raster export. Change it
 * here, then run `pnpm --filter @trove/web brand:generate`.
 */
export const brandMark = {
  viewBox: '0 0 64 64',
  path: 'M17 37C8 33 9 21 18 19C25 17 28 24 33 22C39 20 36 11 44 12C54 13 56 24 48 31C42 36 49 42 43 48C36 54 26 50 25 42C24 34 32 30 36 35',
  strokeWidth: 8,
  terminal: { cx: 36, cy: 35, radius: 4 },
  tileRadius: 16,
  maskableScale: 0.78,
  faviconScale: 1.07,
} as const;

/** Original outlined lettering; product copy continues to use Instrument Sans. */
export const brandWordmark = {
  viewBox: '0 0 120 34',
  width: 120,
  height: 34,
  letters: [
    {
      letter: 'T',
      offset: 0,
      path: 'M2.1 1.5H22.9Q23.5 1.5 23.5 2.1V6.4Q23.5 7 22.9 7H15.5V30.4Q15.5 31 14.9 31H10.1Q9.5 31 9.5 30.4V7H2.1Q1.5 7 1.5 6.4V2.1Q1.5 1.5 2.1 1.5Z',
    },
    {
      letter: 'r',
      offset: -3,
      path: 'M30 11H35.5V14C37 11.5 39.5 10.5 43 10.5V16.3C38.3 15.7 35.8 18.3 35.8 23V31H30Z',
    },
    {
      letter: 'o',
      offset: -3,
      path: 'M58.5 10.2C65 10.2 69.5 14.8 69.5 21C69.5 27.2 65 31.8 58.5 31.8C52 31.8 47.5 27.2 47.5 21C47.5 14.8 52 10.2 58.5 10.2ZM58.5 15.1C55.1 15.1 53 17.5 53 21C53 24.5 55.1 26.9 58.5 26.9C61.9 26.9 64 24.5 64 21C64 17.5 61.9 15.1 58.5 15.1Z',
    },
    {
      letter: 'v',
      offset: -3,
      path: 'M72.5 11H78.4L84 25.5L89.5 11H95.4L87.6 31H80.4Z',
    },
    {
      letter: 'e',
      offset: -3,
      path: 'M121.8 22.5H104.8C105.3 25.6 107.6 27.2 111 27.2C114.2 27.2 116.6 26.1 118.9 24.3L121.7 28.2C118.9 30.6 115.6 31.8 111.1 31.8C104 31.8 99.3 27.5 99.3 21C99.3 14.7 103.7 10.2 110.8 10.2C118 10.2 121.9 14.9 121.9 21V22.5ZM104.9 18.7H116.5C115.9 15.9 114 14.6 110.8 14.6C107.7 14.6 105.6 16.1 104.9 18.7Z',
    },
  ],
} as const;
