import type { ReactNode } from 'react';

import { TripProvider } from '@/components/trip-provider';

/**
 * Everything inside a trip shares one copy of that trip. The provider sits at
 * the layout so it survives navigation between the trip's screens.
 */
export default async function TripLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;

  return <TripProvider tripId={tripId}>{children}</TripProvider>;
}
