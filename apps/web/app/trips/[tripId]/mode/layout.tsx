import type { ReactNode } from 'react';

import { journalSerif } from '@/components/memories/journal-font';
import { TripModeShell } from '@/components/trip-mode-shell';
import { isPlanScoreEnabled } from '@/lib/plan-score/config.server';

/**
 * No Suspense fallback here on purpose: the shell paints its own frame while it
 * loads, and a boundary above it could only put a different shape in front of
 * that one first.
 *
 * The wrapper only carries the serif's variable - `contents` keeps it out of the
 * shell's own layout, which sizes itself against the viewport.
 */
export default async function TripModeLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;

  return (
    <div className={`${journalSerif.variable} contents`}>
      <TripModeShell planScoreEnabled={isPlanScoreEnabled()} tripId={tripId}>
        {children}
      </TripModeShell>
    </div>
  );
}
