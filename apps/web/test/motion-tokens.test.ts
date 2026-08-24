import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { motionDuration, motionEase } from '../lib/motion.ts';

/**
 * A CSS transition needs `200ms` and motion/react needs `0.2`, so the standard
 * duration and the shared easing are spelled twice and neither file can import
 * the other. Nothing in the type system can see that pair, and the failure is
 * quiet: a stylesheet and a spring drifting apart shows up as a stutter where
 * two animations were meant to move together, which no diff review would catch.
 */
const globals = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');

function declaration(token: string) {
  const value = new RegExp(`${token}:\\s*([^;]+);`).exec(globals)?.[1];
  if (value === undefined) throw new Error(`${token} is not declared in globals.css`);
  return value.trim();
}

test('the standard duration means the same thing in CSS and in motion/react', () => {
  const css = declaration('--motion-standard');
  expect(css).toMatch(/^\d+ms$/);
  expect(Number.parseInt(css, 10) / 1000).toBe(motionDuration.standard);
});

test('the shared easing curve means the same thing in CSS and in motion/react', () => {
  const curve = declaration('--ease-standard');
  const points = [...curve.matchAll(/-?\d*\.?\d+/g)].map((match) => Number(match[0]));

  expect(points).toStrictEqual([...motionEase]);
});

/**
 * The other two rungs are CSS-only on purpose. If one grows a TypeScript twin
 * it needs an assertion here too, so this fails rather than letting the pair
 * drift silently.
 */
test('only the standard duration is spelled in both places', () => {
  expect(Object.keys(motionDuration)).toStrictEqual(['standard']);
  expect(globals).toContain('--motion-fast:');
  expect(globals).toContain('--motion-slow:');
});
