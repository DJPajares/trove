import type { MetadataRoute } from 'next';
import { getTranslations } from 'next-intl/server';

import { themeColor } from '@/lib/theme-color';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [app, navigation] = await Promise.all([
    getTranslations('app'),
    getTranslations('navigation'),
  ]);

  return {
    background_color: themeColor.light,
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
    // A manifest is fetched without credentials and cached by the browser, so
    // unlike the layout's `theme-color` it cannot follow the traveller's
    // appearance. It stays light, and the seam it leaves is the splash screen
    // only: the standalone status bar is painted from the page.
    theme_color: themeColor.light,
  };
}
