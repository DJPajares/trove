import type { MetadataRoute } from 'next';
import { getTranslations } from 'next-intl/server';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [app, navigation] = await Promise.all([
    getTranslations('app'),
    getTranslations('navigation'),
  ]);

  return {
    background_color: '#f8f6ed',
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
    // Matches the light `themeColor` in the root layout, so the standalone
    // status bar and the app header are the same surface.
    theme_color: '#f8f6ed',
  };
}
