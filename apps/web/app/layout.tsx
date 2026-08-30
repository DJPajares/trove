import type { Metadata, Viewport } from 'next';
import { Instrument_Sans } from 'next/font/google';
import { cookies } from 'next/headers';
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
import { APPEARANCE_COOKIE, readAppearanceCookie } from '@/lib/theme-cookie';

const instrumentSans = Instrument_Sans({
  display: 'swap',
  subsets: ['latin'],
  variable: '--font-instrument-sans',
  weight: 'variable',
});

/**
 * The theme the status bar should paint, as of the last load. `ThemeColorMeta`
 * writes the cookie whenever the resolved theme changes, so this is behind by at
 * most the toggle it corrects on the client.
 */
async function getAppearance() {
  const cookieStore = await cookies();

  return readAppearanceCookie(cookieStore.get(APPEARANCE_COOKIE)?.value);
}

export async function generateMetadata(): Promise<Metadata> {
  const [t, theme] = await Promise.all([getTranslations('app'), getAppearance()]);

  return {
    applicationName: t('name'),
    // iOS ignores theme-color in standalone and reads this instead - once, at
    // launch, which is why it has to be right in the first byte rather than
    // corrected on the client. Without it iOS falls back to an opaque white bar
    // with dark text in both themes.
    appleWebApp: { statusBarStyle: appleStatusBarStyle[theme], title: t('name') },
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
    // One value, not a `prefers-color-scheme` pair. Appearance is a profile
    // field and `ThemeProvider` runs with `enableSystem={false}`, so the phone's
    // setting does not say which theme Trove is painting; keying the status bar
    // to it left the bar ivory in dark mode. The appearance cookie does say, so
    // the first paint already lands on the right ground and `ThemeColorMeta`
    // only has to follow a toggle from there. Since the manifest ships no
    // `theme_color`, this pair is the whole of what colours the status bar.
    themeColor: themeColor[await getAppearance()],
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
            the splash screen on the theme the traveller last chose. The status
            bar is not the manifest's to say - see `lib/pwa/manifest.ts` for why
            it carries no `theme_color`. React hoists the tag into `head`. */}
        <link crossOrigin="use-credentials" href="/manifest.webmanifest" rel="manifest" />
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
