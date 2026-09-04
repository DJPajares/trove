import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

/**
 * The muted ink is the one colour in the system that sits on nearly every fill
 * we have, so a value that clears AA on `card` can still fail on `secondary` -
 * which is exactly how the itinerary day rail's selected row shipped at 4.28:1.
 * Reading the tokens out of the stylesheet and doing the contrast maths here
 * catches that in the suite rather than in a validation pass months later.
 */

const globals = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');
const light = globals.slice(globals.indexOf(':root {'), globals.indexOf('.dark {'));
const dark = globals.slice(globals.indexOf('.dark {'), globals.indexOf('@theme inline'));

/** WCAG 2.2 AA, text below 18.66px. Every muted pairing carries 12px or 14px text. */
const AA_SMALL_TEXT = 4.5;

/** The ink tokens under test. They are declared separately but must stay in step. */
const INK_TOKENS = ['--muted-foreground', '--text-subtle'] as const;

/** Every fill small muted text is drawn on somewhere in the app. */
const FILL_TOKENS = [
  '--background',
  '--card',
  '--muted',
  '--popover',
  '--secondary',
  '--surface',
  '--surface-hover',
  '--surface-raised',
  '--surface-sunken',
  '--surface-tint',
] as const;

type Oklch = readonly [l: number, c: number, h: number];

function readToken(block: string, token: string): Oklch {
  const match = new RegExp(
    `^\\s*${token}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`,
    'm',
  ).exec(block);

  if (!match) throw new Error(`${token} is not declared as a plain oklch() colour`);

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** oklch -> OKLab -> LMS -> linear sRGB, clamped to gamut the way a display is. */
function linearRgb([l, c, h]: Oklch): [number, number, number] {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);

  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ].map((channel) => Math.min(1, Math.max(0, channel))) as [number, number, number];
}

function relativeLuminance(colour: Oklch) {
  const [r, g, b] = linearRgb(colour);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Oklch, b: Oklch) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const [lighter, darker] = first > second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
}

for (const [theme, block] of [
  ['light', light],
  ['dark', dark],
] as const) {
  test(`muted text meets AA on every fill it sits on in the ${theme} theme`, () => {
    for (const ink of INK_TOKENS) {
      for (const fill of FILL_TOKENS) {
        const ratio = contrast(readToken(block, ink), readToken(block, fill));

        expect(
          Number(ratio.toFixed(3)),
          `${ink} on ${fill} (${theme}) is ${ratio.toFixed(3)}:1`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      }
    }
  });

  /**
   * Two names for one tone. Nothing stops them drifting apart by hand, and a
   * `--text-subtle` left behind would fail on secondary while its twin passed.
   */
  test(`the muted and subtle inks hold the same value in the ${theme} theme`, () => {
    expect(readToken(block, '--text-subtle')).toStrictEqual(readToken(block, '--muted-foreground'));
  });

  /**
   * Contrast is only half of it: darkening the muted ink far enough would clear
   * AA everywhere and flatten the type hierarchy the overhaul is built on.
   * Muted has to keep receding from body text rather than joining it.
   */
  test(`muted text still reads as quieter than body text in the ${theme} theme`, () => {
    const [mutedLightness] = readToken(block, '--muted-foreground');
    const [foregroundLightness] = readToken(block, '--foreground');

    if (theme === 'light') expect(mutedLightness).toBeGreaterThan(foregroundLightness);
    else expect(mutedLightness).toBeLessThan(foregroundLightness);
  });
}
