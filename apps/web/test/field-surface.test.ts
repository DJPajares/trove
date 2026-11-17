import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

const globals = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const light = globals.slice(globals.indexOf(':root {'), globals.indexOf('.dark {'));
const dark = globals.slice(globals.indexOf('.dark {'), globals.indexOf('@theme inline'));
const theme = globals.slice(globals.indexOf('@theme inline'));

function lightness(block: string, token: string) {
  const match = new RegExp(`\\n\\s*${token}: oklch\\(([\\d.]+)`).exec(block);
  if (!match) throw new Error(`${token} is not an oklch colour in this theme`);
  return Number(match[1]);
}

test('the field surface is declared in both themes and exposed to Tailwind', () => {
  expect(light).toContain('--field:');
  expect(dark).toContain('--field:');
  expect(theme).toContain('--color-field: var(--field);');
});

test('a field never shares its colour with the page or a card it sits on', () => {
  for (const block of [light, dark]) {
    const field = lightness(block, '--field');
    for (const ground of ['--background', '--card', '--popover']) {
      expect(
        Math.abs(field - lightness(block, ground)),
        `--field against ${ground}`,
      ).toBeGreaterThan(0.02);
    }
  }
});
