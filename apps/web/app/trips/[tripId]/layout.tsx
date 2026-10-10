import type { ReactNode } from 'react';

import { TripProvider } from '@/components/trip-provider';
import { TripPlacesProvider } from '@/components/trip-places-provider';

/**
 * Everything inside a trip shares one copy of that trip. The provider sits at
 * the layout so it survives navigation between the trip's screens.
 */
export default async function TripLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;

  return (
    <TripProvider key={tripId} tripId={tripId}>
      <TripPlacesProvider>{children}</TripPlacesProvider>
    </TripProvider>
  );
}
