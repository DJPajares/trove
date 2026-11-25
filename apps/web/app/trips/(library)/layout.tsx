import type { ReactNode } from 'react';

import { journalSerif } from '@/components/memories/journal-font';
import { TripsManager } from '@/components/trips-manager';

/**
 * The library renders from this layout rather than its page. In production a
 * `<Link>` prefetches a dynamic route down to its loading boundary, so a
 * layout above that boundary arrives with the prefetch and the page payload
 * that follows reconciles into it. A page standing in as its own loading
 * state mounted twice instead, replaying its entrance and loading states.
 *
 * The library sets its finished journeys in the Memories journal's serif, so
 * the font is loaded here as well as on the journal itself.
 */
export default function TripsLibraryLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className={journalSerif.variable}>
      <TripsManager />
      {children}
    </div>
  );
}
