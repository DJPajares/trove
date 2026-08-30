'use client';

import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect } from 'react';

import { appleStatusBarStyle, themeColor, themeNameFrom } from '@/lib/theme-color';
import { writeAppearanceCookie } from '@/lib/theme-cookie';

function setMeta(name: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);

  if (!tag) {
    tag = document.createElement('meta');
    tag.name = name;
    document.head.append(tag);
  }

  tag.content = content;
}

/**
 * Keeps the phone's status bar on the same theme as the page.
 *
 * The layout renders both tags from the appearance cookie, so a reload already
 * arrives on the right theme. This covers the two cases the server cannot: a
 * traveller toggling appearance mid-session, and a first visit where the cookie
 * has not been written yet - which is also why the effect writes it, from the
 * one place already watching `resolvedTheme`.
 */
export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme();
  // Next re-renders metadata per navigation, which can restore the static value
  // from `viewport`. Re-applying on the path keeps the two in step.
  const pathname = usePathname();

  useEffect(() => {
    const theme = themeNameFrom(resolvedTheme);

    setMeta('theme-color', themeColor[theme]);
    setMeta('apple-mobile-web-app-status-bar-style', appleStatusBarStyle[theme]);
    writeAppearanceCookie(theme);
  }, [pathname, resolvedTheme]);

  return null;
}
