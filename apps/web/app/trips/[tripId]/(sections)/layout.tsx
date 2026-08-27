import type { ReactNode } from 'react';

import { TripChrome } from '@/components/trip-chrome';

/**
 * The trip's sections share one cover and one navigation row. Mounting them
 * here rather than inside each screen is what keeps the cover still when the
 * traveller moves between them. Trip Mode sits outside this group on purpose —
 * it has a shell of its own.
 */
export default async function TripSectionsLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;

  return <TripChrome tripId={tripId}>{children}</TripChrome>;
}
