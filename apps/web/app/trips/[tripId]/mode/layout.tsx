import type { ReactNode } from 'react';

import { TripModeShell } from '@/components/trip-mode-shell';

export default async function TripModeLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;

  return <TripModeShell tripId={tripId}>{children}</TripModeShell>;
}
