import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { EXPENSE_CATEGORY_ORDER, resolveExpenseCategory } from '../lib/expenses/categories.ts';

test('every category has its own icon and its own tint', () => {
  const icons = new Set<unknown>();
  const tints = new Set<string>();

  for (const category of EXPENSE_CATEGORY_ORDER) {
    const { Icon, barClassName } = resolveExpenseCategory(category);
    icons.add(Icon);
    tints.add(barClassName);
  }

  expect(icons.size).toBe(EXPENSE_CATEGORY_ORDER.length);
  expect(tints.size).toBe(EXPENSE_CATEGORY_ORDER.length);
});

test('an expense with no category is shown as other rather than as nothing', () => {
  expect(resolveExpenseCategory(null)).toStrictEqual(resolveExpenseCategory('other'));
  expect(resolveExpenseCategory(undefined)).toStrictEqual(resolveExpenseCategory('other'));
});

/**
 * A bar that reads a literal colour would look right in light mode and stay dark
 * against a dark surface - the same failure the media fallback gradient had
 * before it moved to tokens.
 */
test('tints are theme variables, never literal colours', () => {
  for (const category of EXPENSE_CATEGORY_ORDER) {
    const { barClassName } = resolveExpenseCategory(category);

    expect(barClassName).toMatch(/^bg-category-[a-z]+$/);
    expect(barClassName).not.toMatch(/oklch|#[0-9a-f]{3}/i);
  }
});

/**
 * A tint declared in one theme and forgotten in the other renders as no
 * background at all, and only for the half of travellers using that theme. Both
 * blocks are checked here so it fails in the suite rather than on a device.
 */
test('every tint is declared in both the light and the dark theme', () => {
  const globals = readFileSync(
    fileURLToPath(new URL('../app/globals.css', import.meta.url)),
    'utf8',
  );
  const light = globals.slice(globals.indexOf(':root {'), globals.indexOf('.dark {'));
  const dark = globals.slice(globals.indexOf('.dark {'), globals.indexOf('@theme inline'));
  const theme = globals.slice(globals.indexOf('@theme inline'));

  for (const category of EXPENSE_CATEGORY_ORDER) {
    const token = `--${resolveExpenseCategory(category).barClassName.replace('bg-', '')}`;

    expect(light, `${token} is missing from :root`).toContain(`${token}:`);
    expect(dark, `${token} is missing from .dark`).toContain(`${token}:`);
    // Without the @theme entry Tailwind never emits the utility, so the class
    // name resolves to nothing and the bar is invisible in both themes.
    expect(theme, `${token} is missing from @theme inline`).toContain(`--color${token.slice(1)}:`);
  }
});
