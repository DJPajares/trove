/** Empty cached evidence for planning tests; never connect to a developer's database. */
export function emptyScoringCache() {
  return {
    place: { findMany: async () => [] },
    placeProviderRef: { findUnique: async () => null },
    travelLegCache: { findUnique: async () => null },
    weatherForecastSnapshot: { findUnique: async () => null },
  };
}
