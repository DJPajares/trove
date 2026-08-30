/**
 * The status bar's colour, and it does not move.
 *
 * Four attempts tried to make it follow Trove's theme and all four failed on
 * Android, because the platform does not offer the control they assumed. A page
 * cannot set status bar text colour anywhere: Chrome derives the icon contrast
 * from this colour's luminance, and in an installed standalone app it prefers
 * the manifest's `theme_color`, which it reads once at install and never
 * revisits. So a colour that has to change is a colour that will be wrong -
 * either frozen on the theme the traveller happened to install in, or paired
 * with icons the page cannot recolour to match.
 *
 * White is the one value that survives that. It is right on its own terms in
 * both themes, it cannot go stale, and its luminance guarantees the dark icons
 * that make it readable. In dark mode it reads as a light band above the app
 * rather than a seam - the deliberate cost of a bar that is never unreadable.
 */
export const statusBarColor = '#ffffff';

/**
 * iOS takes keywords rather than colours, and `default` is the light bar with
 * dark text - the same bar `statusBarColor` asks Android for. `black-translucent`
 * is not an option: it forces light text, which is the unreadable half of the
 * problem this pins shut.
 */
export const statusBarStyle = 'default';

/**
 * Trove's two grounds, spelled here as hex as well as in `globals.css` as oklch.
 * These are the manifest's `background_color` - the splash screen, which sits
 * outside the document and so can only be coloured ahead of time. The splash is
 * still allowed to follow the traveller's theme: a stale splash is a flash,
 * which is why it keeps the freedom the status bar gave up.
 *
 * `theme-color` in the test suite asserts these agree with `--background`, so
 * the pair cannot drift unnoticed.
 */
export const themeColor = {
  dark: '#12130d',
  light: '#f8f1e7',
} as const;

export type ThemeName = keyof typeof themeColor;

/**
 * next-themes reports `undefined` until it has resolved, and `light` is both
 * `defaultTheme` and the profile default, so an unresolved theme is light.
 */
export function themeNameFrom(resolvedTheme: string | undefined): ThemeName {
  return resolvedTheme === 'dark' ? 'dark' : 'light';
}
