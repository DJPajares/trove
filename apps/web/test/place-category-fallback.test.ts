import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { resolvePlaceCategoryFallback } from '../lib/media/place-category-fallback.ts';
import { TROVE_PLACE_CATEGORIES } from '../lib/place-categories.ts';

test('every category has its own icon and its own tint', () => {
  const icons = new Set<unknown>();
  const gradients = new Set<string>();

  for (const category of TROVE_PLACE_CATEGORIES) {
    const { Icon, gradientClassName } = resolvePlaceCategoryFallback(category);
    icons.add(Icon);
    gradients.add(gradientClassName);
  }

  expect(icons.size).toBe(TROVE_PLACE_CATEGORIES.length);
  expect(gradients.size).toBe(TROVE_PLACE_CATEGORIES.length);
});

test('a place with no resolvable category falls back to other rather than nothing', () => {
  expect(resolvePlaceCategoryFallback(undefined)).toStrictEqual(
    resolvePlaceCategoryFallback('other'),
  );
});

/**
 * The tints have to darken in dark mode while the fallback's ivory icon stays
 * put, which only works if the gradient reads theme variables rather than
 * literal colours. A hard-coded `oklch(...)` here would look right in light mode
 * and invert in dark, which is exactly what the single-gradient version did.
 */
test('tints are theme variables, never literal colours', () => {
  for (const category of TROVE_PLACE_CATEGORIES) {
    const { gradientClassName } = resolvePlaceCategoryFallback(category);

    expect(gradientClassName).toMatch(/var\(--media-fallback-[a-z-]+-from\)/);
    expect(gradientClassName).toMatch(/var\(--media-fallback-[a-z-]+-to\)/);
    expect(gradientClassName).not.toMatch(/oklch|#[0-9a-f]{3}/i);
  }
});

/**
 * A tint the stylesheet never declares renders as a transparent gradient, which
 * looks like a missing image rather than a branded fallback - and it would only
 * be visible in whichever theme was forgotten. Both blocks are checked here so
 * a token added to one and not the other fails in the suite, not on a device.
 */
test('every tint is declared in both the light and the dark theme', () => {
  const globals = readFileSync(
    fileURLToPath(new URL('../app/globals.css', import.meta.url)),
    'utf8',
  );
  const light = globals.slice(globals.indexOf(':root {'), globals.indexOf('.dark {'));
  const dark = globals.slice(globals.indexOf('.dark {'), globals.indexOf('@theme inline'));

  for (const category of TROVE_PLACE_CATEGORIES) {
    const { gradientClassName } = resolvePlaceCategoryFallback(category);
    const tokens = [...gradientClassName.matchAll(/var\((--media-fallback-[a-z-]+)\)/g)].map(
      (match) => match[1],
    );

    expect(tokens).toHaveLength(2);

    for (const token of tokens) {
      expect(light, `${token} is missing from :root`).toContain(`${token}:`);
      expect(dark, `${token} is missing from .dark`).toContain(`${token}:`);
    }
  }
});

/**
 * The tints are dark in both themes, so the ink on them cannot be a token that
 * flips with the theme - which is exactly what `--primary-foreground` does, and
 * why using it here would leave the icon invisible in dark mode.
 */
test('the fallback ink is the same ivory in both themes', () => {
  const globals = readFileSync(
    fileURLToPath(new URL('../app/globals.css', import.meta.url)),
    'utf8',
  );
  const light = globals.slice(globals.indexOf(':root {'), globals.indexOf('.dark {'));
  const dark = globals.slice(globals.indexOf('.dark {'), globals.indexOf('@theme inline'));
  const inkOf = (block: string) =>
    /--media-fallback-foreground:\s*([^;]+);/.exec(block)?.[1]?.trim();

  expect(inkOf(light)).toBeDefined();
  expect(inkOf(dark)).toBe(inkOf(light));
});
