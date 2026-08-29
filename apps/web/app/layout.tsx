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
import { ThemeColorMeta } from '@/components/theme-color-meta';
import { ThemeProvider } from '@/components/theme-provider';
import { TroveMotionProvider } from '@/components/trove-motion-provider';
import { getAuthUserId } from '@/lib/auth/session';
import { appleStatusBarStyle, themeColor } from '@/lib/theme-color';

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
    // iOS ignores theme-color in standalone and reads this instead. Like
    // themeColor above it can only carry the first-paint default; ThemeColorMeta
    // swaps it to `black` when the app is dark. Without it iOS falls back to an
    // opaque white bar with dark text in both themes.
    appleWebApp: { statusBarStyle: appleStatusBarStyle.light, title: t('name') },
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

export const viewport: Viewport = {
  colorScheme: 'light dark',
  // One value, not a `prefers-color-scheme` pair. Appearance is a profile field
  // and `ThemeProvider` runs with `enableSystem={false}`, so the phone's setting
  // does not say which theme Trove is painting; keying the status bar to it left
  // the bar ivory in dark mode. `ThemeColorMeta` corrects this on the client
  // once the theme resolves, so this only has to cover the first paint, where
  // light is both `defaultTheme` and the profile default.
  themeColor: themeColor.light,
  // Lets Trove paint to the edges of a notched display. It is also what makes
  // every env(safe-area-inset-*) in the shell resolve to a real value.
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [locale, authUserId] = await Promise.all([getLocale(), getAuthUserId()]);

  return (
    <html lang={locale} className={instrumentSans.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <ThemeColorMeta />
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
