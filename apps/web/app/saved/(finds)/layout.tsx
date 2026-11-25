import type { ReactNode } from 'react';

import { journalSerif } from '@/components/memories/journal-font';
import { SavedPlacesManager } from '@/components/saved-places-manager';

/**
 * Finds renders from this layout rather than its page, so the prefetched
 * route and the page payload that follows are one mount of the screen. See
 * the Trips library's layout for why.
 */
export default function FindsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className={journalSerif.variable}>
      <SavedPlacesManager />
      {children}
    </div>
  );
}
