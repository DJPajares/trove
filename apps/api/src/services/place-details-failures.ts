export const PLACE_DETAILS_FAILURE_CODES = ['NOT_FOUND', 'UNUSABLE_LOCATION'] as const;
export type PlaceDetailsFailureCode = (typeof PLACE_DETAILS_FAILURE_CODES)[number];

export const PLACE_DETAILS_FAILURE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export type PlaceDetailsFailureSource = {
  detailsFailedAt?: Date | null;
  detailsFailureCode?: string | null;
};

export function getActivePlaceDetailsFailure(
  source: PlaceDetailsFailureSource | null | undefined,
  now: Date = new Date(),
): PlaceDetailsFailureCode | null {
  if (!source?.detailsFailedAt || !source.detailsFailureCode) return null;
  if (!PLACE_DETAILS_FAILURE_CODES.includes(source.detailsFailureCode as PlaceDetailsFailureCode)) {
    return null;
  }
  if (now.getTime() - source.detailsFailedAt.getTime() > PLACE_DETAILS_FAILURE_TTL_MS) return null;
  return source.detailsFailureCode as PlaceDetailsFailureCode;
}
