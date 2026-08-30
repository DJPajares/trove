import type { MetadataRoute } from 'next';
import { getTranslations } from 'next-intl/server';

import { themeColor, type ThemeName } from '@/lib/theme-color';

/**
 * The manifest paints the standalone splash screen, which sits outside the
 * document, so it opens on the ground the appearance cookie names. That is why
 * the route serving it reads the cookie and the link tag requesting it carries
 * `crossorigin="use-credentials"`: a manifest is fetched without credentials by
 * default, even from its own origin.
 *
 * Deliberately no `theme_color`. Android freezes the manifest's colour into the
 * installed app at install time and never revisits it, so a cookie-driven one
 * only ever looked right in the theme the traveller happened to install in -
 * and in the other it painted a bar whose icon contrast still followed the live
 * page, which is how an install in light mode ended up white-on-white in dark.
 * With no colour to freeze, the only signal left is `<meta name="theme-color">`,
 * which `generateViewport` renders from the same cookie and `ThemeColorMeta`
 * moves with every toggle. A stale splash is a flash; a stale status bar is
 * unreadable, so only the splash keeps a baked value.
 *
 * Everything but `background_color` is fixed. Chrome identifies an installed app
 * by `id` and `start_url`, so those - and the name and icons around them - stay
 * the same in both themes.
 */
export async function buildManifest(theme: ThemeName): Promise<MetadataRoute.Manifest> {
  const [app, navigation] = await Promise.all([
    getTranslations('app'),
    getTranslations('navigation'),
  ]);

  return {
    background_color: themeColor[theme],
    categories: ['travel', 'productivity'],
    description: app('description'),
    display: 'standalone',
    // Falls back to a browser tab rather than the full standalone chrome where
    // standalone is unavailable, instead of dropping straight to a plain page.
    display_override: ['standalone', 'minimal-ui'],
    // A stable id keeps an installed Trove tied to this app across deploys
    // even if start_url ever changes.
    id: '/',
    icons: [
      {
        purpose: 'any',
        sizes: '192x192',
        src: '/icons/trove-192.png',
        type: 'image/png',
      },
      {
        purpose: 'any',
        sizes: '512x512',
        src: '/icons/trove-512.png',
        type: 'image/png',
      },
      {
        purpose: 'maskable',
        sizes: '512x512',
        src: '/icons/trove-512.png',
        type: 'image/png',
      },
    ],
    name: app('name'),
    orientation: 'portrait-primary',
    scope: '/',
    short_name: app('name'),
    // The three things a traveller reaches for from a long-press on the icon.
    // No icons: the launcher falls back to Trove's own rather than showing
    // artwork that does not exist.
    shortcuts: [
      { name: navigation('trips'), short_name: navigation('trips'), url: '/trips' },
      {
        name: navigation('createTrip'),
        short_name: navigation('createTrip'),
        url: '/trips?create=1',
      },
      { name: navigation('saved'), short_name: navigation('saved'), url: '/saved' },
    ],
    start_url: '/',
  };
}
