import { CarFront, Footprints, Plane, TramFront } from 'lucide-react';
import type { ComponentProps } from 'react';

import type { RouteTravelMode } from '@/lib/itinerary/api';

const icons = {
  drive: CarFront,
  flight: Plane,
  transit: TramFront,
  walk: Footprints,
} as const satisfies Record<RouteTravelMode, unknown>;

/**
 * How a travel mode looks, said once.
 *
 * Three surfaces draw this now - the day's route list, Trip Mode's next hop,
 * and the trip progress bar's position marker - and a mode that reads as a
 * tram in one place and a bus in another is a mode the traveller has to
 * re-learn per screen.
 */
export function TravelModeIcon({
  mode,
  ...props
}: Readonly<{ mode: RouteTravelMode } & ComponentProps<'svg'>>) {
  const Icon = icons[mode];

  return <Icon aria-hidden="true" {...props} />;
}
