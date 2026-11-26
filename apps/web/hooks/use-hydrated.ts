'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/**
 * False during the server render and hydration, true once in the browser.
 *
 * For values the server cannot reproduce exactly: Node and the browser ship
 * different ICU data, so even `Intl.DisplayNames` can name a country
 * differently on each side ("Macao SAR China" against "Macao").
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
