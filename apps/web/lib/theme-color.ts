/**
 * The status bar's colour, spelled here as hex as well as in `globals.css` as
 * oklch: `<meta name="theme-color">` cannot read a custom property, and the
 * browser chrome it paints sits outside the document. `theme-color` in the test
 * suite asserts the two agree, so the pair cannot drift unnoticed.
 *
 * Keyed to Trove's own theme rather than to `prefers-color-scheme`. Appearance
 * is a persisted profile field and `ThemeProvider` runs with
 * `enableSystem={false}`, so the phone's setting says nothing about which theme
 * the app is actually painting. Keying the status bar to the OS is what left it
 * white-on-white: on a phone set to light, the media query resolved to ivory in
 * both app themes, while `color-scheme: dark` had the browser draw its status
 * bar icons light.
 */
export const themeColor = {
  dark: '#12130d',
  light: '#f8f1e7',
} as const;

/**
 * iOS ignores `theme-color` in standalone and takes only these three keywords,
 * so the closest readable pair is `default` (light bar, dark text) and `black`
 * (black bar, light text) - near enough to the two grounds that the seam does
 * not show. `black-translucent` is not an option despite the shell already
 * holding content clear of `--safe-top`: it forces light status bar text, which
 * is precisely the unreadable combination over the ivory light theme.
 */
export const appleStatusBarStyle = {
  dark: 'black',
  light: 'default',
} as const;

export type ThemeName = keyof typeof themeColor;

/**
 * next-themes reports `undefined` until it has resolved, and `light` is both
 * `defaultTheme` and the profile default, so an unresolved theme is light.
 */
export function themeNameFrom(resolvedTheme: string | undefined): ThemeName {
  return resolvedTheme === 'dark' ? 'dark' : 'light';
}
