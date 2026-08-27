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
import { ThemeProvider } from '@/components/theme-provider';
import { TroveMotionProvider } from '@/components/trove-motion-provider';
import { getAuthUserId } from '@/lib/auth/session';

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
  themeColor: [
    { color: '#f8f6ed', media: '(prefers-color-scheme: light)' },
    { color: '#19382b', media: '(prefers-color-scheme: dark)' },
  ],
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
