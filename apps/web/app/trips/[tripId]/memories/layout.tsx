import type { ReactNode } from 'react';

import { journalSerif } from '@/components/memories/journal-font';

/**
 * Memories is an experience of its own, like Trip Mode: it leaves the trip's
 * shared cover and tab row behind, and on a phone the global bar steps aside
 * for it (`isImmersiveTripPath`). The slot is what the page canvas, the shell's
 * padding and the journal's paper all key off (globals.css), and the serif is
 * loaded here and nowhere else, so no other screen pays for it.
 */
export default function TripMemoriesLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className={journalSerif.variable} data-slot="memories-journal">
      {children}
    </div>
  );
}
