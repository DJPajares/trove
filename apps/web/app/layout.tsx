import type { Metadata, Viewport } from 'next';
import { Instrument_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import './globals.css';
import { AppShell } from '@/components/app-shell';
import { OnboardingGate } from '@/components/onboarding-gate';
import { PwaProvider } from '@/components/pwa-provider';
import { QueryProvider } from '@/components/query-provider';
import { PreferencesProvider } from '@/components/preferences-provider';
import { AppearanceCookie } from '@/components/appearance-cookie';
import { ThemeProvider } from '@/components/theme-provider';
import { TroveMotionProvider } from '@/components/trove-motion-provider';
import { getAuthUserId } from '@/lib/auth/session';
import { statusBarColor, statusBarStyle } from '@/lib/theme-color';

const instrumentSans = Instrument_Sans({
  display: 'swap',
  subsets: ['latin'],
  variable: '--font-instrument-sans',
  weight: 'variable',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');

  return {
    applicationName: t('name'),
    // iOS ignores theme-color in standalone and reads this instead, once, at
    // launch. Pinned like its Android counterpart: `default` is the light bar
    // with dark text, which is what `statusBarColor` asks Android for.
    appleWebApp: { statusBarStyle, title: t('name') },
    description: t('description'),
    icons: {
      // iOS ignores SVG for the home-screen icon, so point it at the PNG the
      // manifest already ships.
      apple: '/icons/trove-192.png',
      icon: '/icon.svg',
    },
    title: {
      default: t('name'),
      template: `%s | ${t('name')}`,
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  return {
    colorScheme: 'light dark',
    // One pinned value rather than a theme or a `prefers-color-scheme` pair.
    // Android derives the status bar's icon contrast from this colour and has no
    // separate control the page can reach, so a bar that moves is a bar that
    // eventually pairs a colour with icons it cannot recolour. See
    // `lib/theme-color.ts`.
    themeColor: statusBarColor,
    // Lets Trove paint to the edges of a notched display. It is also what makes
    // every env(safe-area-inset-*) in the shell resolve to a real value.
    viewportFit: 'cover',
  };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [locale, authUserId] = await Promise.all([getLocale(), getAuthUserId()]);

  return (
    <html lang={locale} className={instrumentSans.variable} suppressHydrationWarning>
      <body>
        {/* Not `metadata.manifest`: the link Next injects for it cannot carry
            `crossorigin`, and a manifest is fetched without credentials by
            default even from its own origin. With the cookie, the route can open
            the splash screen on the theme the traveller last chose. React hoists
            the tag into `head`. */}
        <link crossOrigin="use-credentials" href="/manifest.webmanifest" rel="manifest" />
        <ThemeProvider>
          <AppearanceCookie />
          <TroveMotionProvider>
            <NextIntlClientProvider>
              <QueryProvider userId={authUserId}>
                <PwaProvider>
                  <PreferencesProvider locale={locale}>
                    <OnboardingGate />
                    <AppShell isSignedIn={authUserId !== null}>{children}</AppShell>
                  </PreferencesProvider>
                </PwaProvider>
              </QueryProvider>
            </NextIntlClientProvider>
          </TroveMotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
