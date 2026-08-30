import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, vi } from 'vitest';

import { statusBarColor, statusBarStyle, themeColor, themeNameFrom } from '../lib/theme-color.ts';
import { readAppearanceCookie } from '../lib/theme-cookie.ts';

/**
 * `--background` is oklch in CSS and hex in `theme-color.ts`, because a manifest
 * cannot read a custom property. Nothing in the type system can see that pair,
 * and the failure is silent: the splash screen keeps the old palette while the
 * page paints the new one. The two grounds have already moved twice, so this
 * converts the tokens and asserts the hexes still match.
 */
const globals = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');

function block(selector: string) {
  const start = globals.indexOf(selector);
  if (start < 0) throw new Error(`${selector} is not declared in globals.css`);

  const open = globals.indexOf('{', start);
  let depth = 0;

  for (let index = open; index < globals.length; index += 1) {
    if (globals[index] === '{') depth += 1;
    else if (globals[index] === '}') {
      depth -= 1;
      if (depth === 0) return globals.slice(start, index + 1);
    }
  }

  throw new Error(`${selector} is never closed in globals.css`);
}

function background(selector: string) {
  const value = /--background:\s*oklch\(([^)]+)\);/.exec(block(selector))?.[1];
  if (value === undefined) throw new Error(`${selector} declares no oklch --background`);

  const channels = value.trim().split(/\s+/).map(Number);
  if (channels.length !== 3 || channels.some(Number.isNaN)) {
    throw new Error(`${selector} declares an --background this test cannot read: ${value}`);
  }

  const [lightness, chroma, hue] = channels as [number, number, number];
  return oklchToHex(lightness, chroma, hue);
}

/** oklch -> linear sRGB -> gamma-encoded hex, the same path a browser takes. */
function oklchToHex(lightness: number, chroma: number, hue: number) {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];

  return `#${linear
    .map((channel) => {
      const clamped = Math.min(1, Math.max(0, channel));
      const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return Math.round(encoded * 255)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}

test('the splash screen paints the same grounds the page does', () => {
  expect(background(':root {')).toBe(themeColor.light);
  expect(background('.dark {')).toBe(themeColor.dark);
});

/**
 * Android has no control over status bar icon colour that a page can reach - it
 * derives the contrast from this colour's luminance. A light bar is therefore
 * the only way to ask for the dark icons that read against it, and iOS's
 * `default` keyword is the same bar. `black-translucent` forces light text,
 * which is the unreadable half of the bug this pins shut.
 */
test('the status bar is pinned to one readable bar', () => {
  expect(statusBarColor).toBe('#ffffff');
  expect(statusBarStyle).toBe('default');
});

/**
 * next-themes reports `undefined` before it resolves. Falling back to anything
 * but light would write the wrong appearance cookie on first paint, since light
 * is both `defaultTheme` and the profile default.
 */
test('an unresolved theme is treated as light', () => {
  expect(themeNameFrom(undefined)).toBe('light');
  expect(themeNameFrom('light')).toBe('light');
  expect(themeNameFrom('dark')).toBe('dark');
});

// The manifest is a server module and reaches for its copy through next-intl,
// which resolves to its client build under Vitest. The strings are not what is
// under test here.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

/**
 * The splash screen sits outside the document and so cannot be corrected on the
 * client. A manifest hardcoded light is what left it ivory under the dark theme,
 * so this asserts it opens on whichever ground it is asked for.
 */
test('the splash screen opens on the ground it is given', async () => {
  const { buildManifest } = await import('../lib/pwa/manifest.ts');
  const dark = await buildManifest('dark');
  const light = await buildManifest('light');

  expect(dark.background_color).toBe(themeColor.dark);
  expect(light.background_color).toBe(themeColor.light);
});

/**
 * Android reads the manifest's `theme_color` once, at install, and never
 * revisits it. A themed value is therefore right only in the theme the traveller
 * installed in - the bug. Pinning it makes the freeze harmless, so what this
 * guards is that the two themes never disagree about it again.
 */
test('the manifest freezes the same status bar in both themes', async () => {
  const { buildManifest } = await import('../lib/pwa/manifest.ts');

  expect((await buildManifest('dark')).theme_color).toBe(statusBarColor);
  expect((await buildManifest('light')).theme_color).toBe(statusBarColor);
});

/**
 * Chrome identifies an installed app by these, so a theme that changed them
 * would read as a different app rather than a recoloured one.
 */
test('the manifest is the same app in both themes', async () => {
  const { buildManifest } = await import('../lib/pwa/manifest.ts');
  const dark = await buildManifest('dark');
  const light = await buildManifest('light');

  expect(dark.id).toBe(light.id);
  expect(dark.start_url).toBe(light.start_url);
  expect(dark.scope).toBe(light.scope);
  expect(dark.name).toBe(light.name);
  expect(dark.icons).toStrictEqual(light.icons);
});

/**
 * The cookie is the only thing telling the server which theme to paint, and it
 * arrives as an arbitrary string. Anything but `dark` has to fall back to light,
 * the theme a first visit is about to settle on.
 */
test('an unwritten appearance cookie reads as light', () => {
  expect(readAppearanceCookie('dark')).toBe('dark');
  expect(readAppearanceCookie('light')).toBe('light');
  expect(readAppearanceCookie(undefined)).toBe('light');
  expect(readAppearanceCookie('')).toBe('light');
  expect(readAppearanceCookie('Dark')).toBe('light');
});
