'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MapRouteLeg } from '@/lib/maps/map-route-selection';

/** Point and explicit-leg selection change together. A new day or itinerary
 * revision invalidates both, including when the map is retained off screen. */
export function useMapSelection(scope: string) {
  const [selection, setSelection] = useState<{
    scope: string;
    pointId: string | null;
    routeId: string | null;
  } | null>(null);
  const current = selection?.scope === scope ? selection : null;
  useEffect(() => {
    setSelection(null);
  }, [scope]);
  const setSelectedPointId = useCallback(
    (pointId: string | null) => {
      setSelection({ scope, pointId, routeId: null });
    },
    [scope],
  );
  const selectRoute = useCallback(
    (leg: MapRouteLeg) => {
      setSelection({ scope, pointId: leg.origin.pointId, routeId: leg.id });
    },
    [scope],
  );
  const clearSelection = useCallback(() => setSelection(null), []);
  return {
    selectedPointId: current?.pointId ?? null,
    selectedRouteId: current?.routeId ?? null,
    setSelectedPointId,
    selectRoute,
    clearSelection,
  };
}
