import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { MAP_DAY_TINT_COUNT, mapDayTint } from '../lib/maps/map-day-tints.ts';

const tintIndexes = Array.from({ length: MAP_DAY_TINT_COUNT }, (_, index) => index);

test('every day before the palette repeats has its own tint', () => {
  const tints = new Set(tintIndexes.map((index) => mapDayTint(index).marker));

  expect(tints.size).toBe(MAP_DAY_TINT_COUNT);
  expect(mapDayTint(MAP_DAY_TINT_COUNT)).toStrictEqual(mapDayTint(0));
});

/**
 * The markers are built as DOM outside React, so a literal colour would never
 * follow the theme. Every tint has to be a theme variable.
 */
test('tints are theme variables, never literal colours', () => {
  for (const index of tintIndexes) {
    const { dot, marker } = mapDayTint(index);

    expect(dot).toMatch(/^bg-map-day-\d$/);
    expect(marker).toBe(`${dot} text-map-day-foreground`);
  }
});

/**
 * A tint declared in one theme and forgotten in the other renders as no fill
 * at all, and only for the half of travellers using that theme. Without the
 * `@theme inline` entry Tailwind never emits the utility in the first place.
 */
test('every tint is declared in both themes and reaches Tailwind', () => {
  const globals = readFileSync(
    fileURLToPath(new URL('../app/globals.css', import.meta.url)),
    'utf8',
  );
  const light = globals.slice(globals.indexOf(':root {'), globals.indexOf('.dark {'));
  const dark = globals.slice(globals.indexOf('.dark {'), globals.indexOf('@theme inline'));
  const theme = globals.slice(globals.indexOf('@theme inline'));
  const tokens = [
    ...tintIndexes.map((index) => `--${mapDayTint(index).dot.replace('bg-', '')}`),
    '--map-day-foreground',
  ];

  for (const token of tokens) {
    expect(light, `${token} is missing from :root`).toContain(`${token}:`);
    expect(dark, `${token} is missing from .dark`).toContain(`${token}:`);
    expect(theme, `${token} is missing from @theme inline`).toContain(
      `--color-${token.slice(2)}: var(${token});`,
    );
  }
});
