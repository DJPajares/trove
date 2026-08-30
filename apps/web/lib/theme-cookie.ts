import { type ThemeName, themeNameFrom } from '@/lib/theme-color';

/**
 * Carries the resolved theme to the server so the root layout can render the
 * matching `theme-color` and Apple status-bar style in the first byte of HTML.
 *
 * next-themes keeps appearance in `localStorage`, which the server cannot read,
 * and appearance is a profile field rather than an OS setting, so
 * `prefers-color-scheme` cannot stand in for it either. That left the server
 * emitting the light default for everyone: a dark-mode traveller saw a white
 * status bar until hydration, and on iOS standalone - where the status-bar style
 * is read once at launch and never again - for the whole session.
 */
export const APPEARANCE_COOKIE = 'trove-appearance';

const ONE_YEAR_IN_SECONDS = 31_536_000;

/**
 * An absent or unrecognised cookie resolves to light, matching both
 * `defaultTheme` and the profile default, so a first visit paints the same
 * ground the client is about to settle on.
 */
export function readAppearanceCookie(value: string | undefined): ThemeName {
  return themeNameFrom(value);
}

/**
 * Not `Secure`: dev runs over plain http on localhost, and the cookie carries
 * nothing but which of two themes the traveller chose. `Lax` is enough - the
 * value is only ever read while rendering Trove's own pages.
 */
export function writeAppearanceCookie(theme: ThemeName) {
  document.cookie = `${APPEARANCE_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR_IN_SECONDS}; SameSite=Lax`;
}
