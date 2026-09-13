import { expect, test } from 'vitest';

import { dayLocality, localityFromAddress } from '../lib/itinerary/day-place.ts';

test('the town is read from the segment before the country', () => {
  // The shapes Trove actually caches, postcode trailing the town.
  expect(localityFromAddress('501 Buckland Road, Matamata 3472, New Zealand')).toBe('Matamata');
  expect(localityFromAddress('501 Buckland Road, Hinuera, Matamata 3472, New Zealand')).toBe(
    'Matamata',
  );
  expect(localityFromAddress('17 Tryon Street, Whakarewarewa, Rotorua 3010, New Zealand')).toBe(
    'Rotorua',
  );
  expect(localityFromAddress('Whakarewarewa, Rotorua, New Zealand')).toBe('Rotorua');
  expect(localityFromAddress('Ray Emery Drive, Māngere, Auckland 2022, New Zealand')).toBe(
    'Auckland',
  );
});

test('a street is never returned as a town', () => {
  // "370J Alexandra Rd, Singapore 159953" counts back onto the road, which is
  // the failure this guard exists for.
  expect(localityFromAddress('370J Alexandra Rd, Singapore 159953')).toBeNull();
  // A street sitting where the town usually does, which happens when an address
  // carries no country.
  expect(localityFromAddress('Unit 4, 12 Queen Street, Sydney NSW 2000')).toBeNull();
  // The same shape with a country present reads correctly, so the guard is not
  // simply refusing anything with a street in the address.
  expect(localityFromAddress('1 High Street, Camden, London, UK')).toBe('London');
});

test('anything that is not a name resolves to nothing', () => {
  expect(localityFromAddress(null)).toBeNull();
  expect(localityFromAddress('')).toBeNull();
  expect(localityFromAddress('Singapore')).toBeNull();
  expect(localityFromAddress('Somewhere, Anywhere')).toBeNull();
  // A bare postcode in the town's place.
  expect(localityFromAddress('Some Way, 3472, New Zealand')).toBeNull();
});

test('a day is named after the town most of it is spent in', () => {
  expect(
    dayLocality([
      '501 Buckland Road, Matamata 3472, New Zealand',
      '501 Buckland Road, Hinuera, Matamata 3472, New Zealand',
      'Whites Road, Putāruru 3483, New Zealand',
    ]),
  ).toBe('Matamata');
});

test('a tie goes to the town the day starts in', () => {
  expect(
    dayLocality([
      '501 Buckland Road, Matamata 3472, New Zealand',
      'Whites Road, Putāruru 3483, New Zealand',
      'Main Road, Matamata 3472, New Zealand',
      'Tirau Street, Putāruru 3483, New Zealand',
    ]),
  ).toBe('Matamata');
});

test('a day that scatters is left unnamed', () => {
  // One stop each in three towns is a drive, not a day somewhere.
  expect(
    dayLocality([
      'A Road, Matamata 3472, New Zealand',
      'B Road, Rotorua 3010, New Zealand',
      'C Road, Taupō 3330, New Zealand',
    ]),
  ).toBeNull();
  // A single stop is a visit, not a day.
  expect(dayLocality(['501 Buckland Road, Matamata 3472, New Zealand'])).toBeNull();
  expect(dayLocality([])).toBeNull();
});
