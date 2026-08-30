'use client';

import { useTheme } from 'next-themes';
import { useEffect } from 'react';

import { themeNameFrom } from '@/lib/theme-color';
import { writeAppearanceCookie } from '@/lib/theme-cookie';

/**
 * Keeps the appearance cookie on the theme the app is actually painting, so the
 * next launch opens its splash screen on the right ground.
 *
 * The status bar used to be this component's job too, and is not any more: it is
 * pinned in `lib/theme-color.ts` and carried by the layout and the manifest,
 * neither of which needs correcting on the client. What is left is the splash,
 * which sits outside the document and can only be coloured by a value the server
 * already holds - hence a cookie, written from the one place already watching
 * `resolvedTheme`.
 */
export function AppearanceCookie() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    writeAppearanceCookie(themeNameFrom(resolvedTheme));
  }, [resolvedTheme]);

  return null;
}
