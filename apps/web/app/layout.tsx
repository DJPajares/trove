import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import './globals.css';
import { AppShell } from '@/components/app-shell';
import { PwaProvider } from '@/components/pwa-provider';
import { ThemeProvider } from '@/components/theme-provider';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
});
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');

  return {
    applicationName: t('name'),
    description: t('description'),
    icons: {
      apple: '/icon.svg',
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
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          <PwaProvider>
            <NextIntlClientProvider>
              <AppShell>{children}</AppShell>
            </NextIntlClientProvider>
          </PwaProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
