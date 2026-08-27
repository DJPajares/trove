import type { ReactNode } from 'react';

import { TripModeShell } from '@/components/trip-mode-shell';
import { isPlanScoreEnabled } from '@/lib/plan-score/config.server';

/**
 * No Suspense fallback here on purpose: the shell paints its own frame while it
 * loads, and a boundary above it could only put a different shape in front of
 * that one first.
 */
export default async function TripModeLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;

  return (
    <TripModeShell planScoreEnabled={isPlanScoreEnabled()} tripId={tripId}>
      {children}
    </TripModeShell>
  );
}
