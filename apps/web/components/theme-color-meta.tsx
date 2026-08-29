'use client';

import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect } from 'react';

import { appleStatusBarStyle, themeColor, themeNameFrom } from '@/lib/theme-color';

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
 * The static `themeColor` in `viewport` can only describe one theme, and it
 * cannot describe Trove's: appearance is a profile field resolved on the client,
 * so the server has nothing to render. The static value is therefore the light
 * default, and this corrects it once the theme is known.
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
  }, [pathname, resolvedTheme]);

  return null;
}
