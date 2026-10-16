import { expect, test } from 'vitest';
import { activitySuggestionCandidateIds } from '../src/services/activity-suggestion-candidates.js';

const place = (id: string, placeId = id) => ({ id, placeId });
const day = {
  dailyBaseTripPlaceId: null,
  dailyBaseDepartureTripPlaceId: null,
  items: [],
};

test('activity candidates exclude every stay source across the trip, including conflicting bookings', () => {
  const result = activitySuggestionCandidateIds({
    defaultStayTripPlaceId: 'ritz',
    stayRanges: [{ tripPlace: { id: 'marina' } }, { tripPlace: { id: 'family' } }],
    itineraryDays: [
      { ...day, dailyBaseTripPlaceId: 'friend', dailyBaseDepartureTripPlaceId: 'airport-hotel' },
      // Even a day without stay endpoints must not offer the default/ranges as activities.
      day,
    ],
    reservations: [
      { type: 'ACCOMMODATION', tripPlaceId: 'booking-a' },
      { type: 'ACCOMMODATION', tripPlaceId: 'booking-b' },
      { type: 'ACCOMMODATION', tripPlaceId: null },
      { type: 'ACTIVITY', tripPlaceId: 'ticketed-museum' },
    ],
    tripPlaces: [
      'ritz',
      'marina',
      'family',
      'friend',
      'airport-hotel',
      'booking-a',
      'booking-b',
      'ticketed-museum',
    ].map((id) => place(id)),
  });
  expect([...result]).toEqual(['ticketed-museum']);
});

test('uses Place identity to exclude scheduled duplicates while preserving distinct hotel attractions', () => {
  const result = activitySuggestionCandidateIds({
    defaultStayTripPlaceId: 'hotel',
    stayRanges: [],
    reservations: [],
    itineraryDays: [{ ...day, items: [{ tripPlaceId: 'museum' }] }],
    tripPlaces: [
      place('hotel'),
      place('hotel-alias', 'hotel'),
      place('museum'),
      place('museum-alias', 'museum'),
      place('hotel-observation-deck'),
      place('hotel-restaurant'),
      place('unscheduled'),
      place('unscheduled-alias', 'unscheduled'),
    ],
  });
  expect([...result]).toEqual(['hotel-observation-deck', 'hotel-restaurant', 'unscheduled']);
});

test('a hotel chosen as a visit remains eligible when it has no accommodation role', () => {
  expect([
    ...activitySuggestionCandidateIds({
      defaultStayTripPlaceId: null,
      stayRanges: [],
      reservations: [],
      itineraryDays: [day],
      tripPlaces: [place('landmark-hotel')],
    }),
  ]).toEqual(['landmark-hotel']);
});
