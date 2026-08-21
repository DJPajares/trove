import type { Itinerary, ItineraryDayMoveInput } from './api';

function matches(actual: string[], expected: string[]) {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

function matchesBase(
  day: Itinerary['days'][number],
  expected: ItineraryDayMoveInput['expectedSourceBase'],
) {
  return (
    day.dailyBaseTripPlaceId === expected.dailyBaseTripPlaceId &&
    day.dailyBaseDepartureTripPlaceId === expected.dailyBaseDepartureTripPlaceId
  );
}

function setBase(
  day: Itinerary['days'][number],
  base: ItineraryDayMoveInput['expectedSourceBase'],
) {
  day.dailyBaseTripPlaceId = base.dailyBaseTripPlaceId;
  day.dailyBaseDepartureTripPlaceId = base.dailyBaseDepartureTripPlaceId;
}

/** Applies one idempotent whole-day move to an already-cloned itinerary snapshot. */
export function applyItineraryDayMove(
  itinerary: Itinerary,
  sourceItineraryDayId: string,
  input: ItineraryDayMoveInput,
) {
  const source = itinerary.days.find((candidate) => candidate.id === sourceItineraryDayId);
  const target = itinerary.days.find((candidate) => candidate.id === input.targetItineraryDayId);
  if (!source || !target) return itinerary;
  const sourceIds = source.items.map(({ id }) => id);
  const targetIds = target.items.map(({ id }) => id);
  const finalSourceIds = input.strategy === 'swap' ? input.expectedTargetItemIds : [];
  const finalTargetIds =
    input.strategy === 'swap'
      ? input.expectedSourceItemIds
      : [...input.expectedTargetItemIds, ...input.expectedSourceItemIds];
  const finalSourceBase =
    input.strategy === 'swap'
      ? input.expectedTargetBase
      : { dailyBaseDepartureTripPlaceId: null, dailyBaseTripPlaceId: null };
  const finalTargetBase = input.expectedSourceBase;
  if (
    matches(sourceIds, finalSourceIds) &&
    matches(targetIds, finalTargetIds) &&
    matchesBase(source, finalSourceBase) &&
    matchesBase(target, finalTargetBase)
  ) {
    return itinerary;
  }
  if (
    !matches(sourceIds, input.expectedSourceItemIds) ||
    !matches(targetIds, input.expectedTargetItemIds) ||
    !matchesBase(source, input.expectedSourceBase) ||
    !matchesBase(target, input.expectedTargetBase)
  ) {
    return itinerary;
  }
  const sourceItems = [...source.items];
  const targetItems = [...target.items];
  source.items = input.strategy === 'swap' ? targetItems : [];
  target.items = input.strategy === 'swap' ? sourceItems : [...targetItems, ...sourceItems];
  setBase(source, finalSourceBase);
  setBase(target, finalTargetBase);
  const now = new Date().toISOString();
  for (const day of [source, target]) {
    day.items.forEach((item, position) => {
      item.itineraryDayId = day.id;
      item.position = position;
      item.updatedAt = now;
    });
  }
  return itinerary;
}
