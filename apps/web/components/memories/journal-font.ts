import { Instrument_Serif } from 'next/font/google';

/**
 * The journal's voice: Instrument Serif, the serif companion to the Instrument
 * Sans the rest of Trove is set in. It comes in one weight and two styles, so
 * every use sets `font-normal` and the browser never synthesises a bold.
 *
 * Only the Memories journal, and Home, the Trips library and a trip's overview
 * - which set finished journeys in the journal's voice - import this, so no
 * other screen downloads it. The variable is set on the journal's layout, on
 * each of its popups, which render into <body> outside that layout, and on
 * those three pages.
 */
export const journalSerif = Instrument_Serif({
  display: 'swap',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-instrument-serif',
  weight: '400',
});
