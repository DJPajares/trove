'use client';

import { useEffect } from 'react';

/**
 * For a screen whose cover photograph runs beneath the header and the floating
 * controls. While the page rests at its top, both take the photograph's ink
 * (globals.css reads this flag); once the cover's own words start to scroll
 * beneath them they need their surface back.
 */
export function useCoverUnderHeader(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const sync = () => {
      if (window.scrollY <= 16) root.setAttribute('data-cover-under-header', 'true');
      else root.removeAttribute('data-cover-under-header');
    };
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    return () => {
      window.removeEventListener('scroll', sync);
      root.removeAttribute('data-cover-under-header');
    };
  }, [enabled]);
}
