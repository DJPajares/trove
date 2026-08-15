import { resolve } from 'node:path';

import { config } from 'dotenv';

import { createPrismaClient } from '../src/index.js';

/**
 * A complete, browsable Japan trip for local development.
 *
 * Trove profiles are keyed by the Supabase auth user id, so the seed writes
 * against whichever account you actually sign in with: set `TROVE_SEED_USER_ID`
 * to your Supabase user UUID. Locally the `auth.users` table is the compatibility
 * stub from `docker/postgres/init`, so the seed inserts the row itself; against a
 * hosted project the row already exists and the insert is a no-op. Nothing here
 * bypasses authentication.
 *
 * Dates are computed so the trip finished two weeks ago, which is what puts Home,
 * Trip Overview, and Trip Story into their completed states. Re-running the seed
 * therefore shifts the trip forward; everything else is keyed by fixed ids and
 * upserted, so re-running is otherwise safe.
 *
 * Memory photos are deliberately absent. They would need matching objects in the
 * private `memory-photos` bucket, and rows without them render as broken images.
 * Add photos through the UI once you are signed in.
 */

config({ path: resolve(import.meta.dirname, '../../../.env') });

const prisma = createPrismaClient();

const userId = process.env.TROVE_SEED_USER_ID ?? '';
const reset = process.argv.includes('--reset');

const TRIP_TIME_ZONE = 'Asia/Tokyo';
const HOME_CURRENCY = 'SGD';
const TRIP_CURRENCY = 'JPY';

/** Fixed ids keep the seed idempotent and easy to recognise in the database. */
const id = (suffix: string) => `00000000-0000-7000-8000-${suffix.padStart(12, '0')}`;

const TRIP = id('1');
const HOME_PLACE = id('10');

const PLACES = {
  fushimiInari: { id: id('25'), providerId: 'ChIJIW0uPRAIAWARQz-D2ZKDH0g' },
  gionAlley: { id: id('23'), name: 'Gion back alley', timeZone: TRIP_TIME_ZONE },
  hakoneRyokan: { id: id('22'), name: 'Hakone ryokan', timeZone: TRIP_TIME_ZONE },
  narapark: { id: id('26'), name: 'Nara deer park', timeZone: TRIP_TIME_ZONE },
  osakaKitchen: { id: id('27'), name: 'Dotonbori street kitchen', timeZone: TRIP_TIME_ZONE },
  sensoji: { id: id('24'), providerId: 'ChIJ8T1GpMGOGGARDYGSgpooDWw' },
  shibuyaSky: { id: id('21'), name: 'Shibuya Sky', timeZone: TRIP_TIME_ZONE },
} as const;

const TRIP_PLACES = {
  fushimiInari: id('35'),
  gionAlley: id('33'),
  hakoneRyokan: id('32'),
  narapark: id('36'),
  osakaKitchen: id('37'),
  sensoji: id('34'),
  shibuyaSky: id('31'),
} as const;

function dateOnly(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function addDays(from: Date, days: number) {
  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + days);
  return dateOnly(next);
}

function localTime(value: string) {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

/** The stored instant for a Tokyo wall time; JST is a fixed +09:00 with no DST. */
function tokyoInstant(date: Date, time: string) {
  return new Date(`${date.toISOString().slice(0, 10)}T${time}:00.000+09:00`);
}

const END_DATE = addDays(dateOnly(new Date()), -14);
const START_DATE = addDays(END_DATE, -9);
const dayDate = (offset: number) => addDays(START_DATE, offset);

async function clearSeededTrip() {
  // Scoped to the ids this seed owns: the account may hold real trips and saved
  // Places alongside it, and a reset must not touch them.
  const seededPlaceIds = [HOME_PLACE, ...Object.values(PLACES).map((place) => place.id)];

  // The Trip cascade takes its days, items, places, reservations, tasks, info,
  // expenses, and memories. Places are Restrict-protected, so they go last.
  await prisma.trip.deleteMany({ where: { id: TRIP } });
  await prisma.savedPlace.deleteMany({
    where: { ownerId: userId, placeId: { in: seededPlaceIds } },
  });
  await prisma.place.deleteMany({ where: { id: { in: seededPlaceIds } } });
}

async function seedIdentity() {
  // Locally this is the auth compatibility stub; hosted Supabase owns the real row.
  await prisma.$executeRaw`
    insert into auth.users (id) values (${userId}::uuid) on conflict (id) do nothing
  `;

  await prisma.place.upsert({
    where: { id: HOME_PLACE },
    create: {
      customLatitude: 1.3521,
      customLongitude: 103.8198,
      customName: 'Singapore',
      customTimeZone: 'Asia/Singapore',
      id: HOME_PLACE,
      kind: 'CUSTOM',
      ownerId: userId,
    },
    update: {},
  });

  await prisma.profile.upsert({
    where: { id: userId },
    create: {
      dateFormat: 'YEAR_MONTH_DAY',
      displayName: 'Trove developer',
      distanceUnit: 'KILOMETERS',
      homeCurrencyCode: HOME_CURRENCY,
      homePlaceId: HOME_PLACE,
      id: userId,
      temperatureUnit: 'CELSIUS',
      timeFormat: 'HOUR_24',
    },
    update: { homeCurrencyCode: HOME_CURRENCY, homePlaceId: HOME_PLACE },
  });
}

async function seedPlaces() {
  const custom = [
    PLACES.shibuyaSky,
    PLACES.hakoneRyokan,
    PLACES.gionAlley,
    PLACES.narapark,
    PLACES.osakaKitchen,
  ];

  for (const place of custom) {
    await prisma.place.upsert({
      where: { id: place.id },
      create: {
        customName: place.name,
        customTimeZone: place.timeZone,
        id: place.id,
        kind: 'CUSTOM',
        ownerId: userId,
      },
      update: { customName: place.name },
    });
  }

  // A provider Place stores nothing but its reference: no name, no coordinates,
  // no timezone. Trove resolves the current name from Google on demand, which is
  // exactly what these two exist to exercise.
  for (const place of [PLACES.sensoji, PLACES.fushimiInari]) {
    await prisma.place.upsert({
      where: { id: place.id },
      create: { id: place.id, kind: 'PROVIDER' },
      update: {},
    });
    await prisma.placeProviderRef.upsert({
      where: {
        provider_externalPlaceId: { externalPlaceId: place.providerId, provider: 'GOOGLE' },
      },
      create: { externalPlaceId: place.providerId, placeId: place.id, provider: 'GOOGLE' },
      update: { placeId: place.id },
    });
  }

  // Saved Places are a separate relationship to the same Place, so the trip's
  // Places and the global Saved Places list overlap without depending on each other.
  for (const [index, place] of [PLACES.sensoji, PLACES.shibuyaSky, PLACES.narapark].entries()) {
    await prisma.savedPlace.upsert({
      where: { ownerId_placeId: { ownerId: userId, placeId: place.id } },
      create: {
        note: index === 0 ? 'Go early, before the shopping street fills up.' : null,
        ownerId: userId,
        placeId: place.id,
      },
      update: {},
    });
  }
}

async function seedTrip() {
  await prisma.trip.upsert({
    where: { id: TRIP },
    create: {
      budgetAmount: '4500.00',
      budgetCurrencyCode: HOME_CURRENCY,
      endDate: END_DATE,
      experienceNote: 'Slower than we planned, and better for it.',
      experienceRating: 5,
      id: TRIP,
      name: 'Japan in autumn',
      notes: 'Tokyo, Hakone, Kyoto, Osaka. Trains booked ahead, everything else loose.',
      ownerId: userId,
      partySize: 2,
      planningReadiness: 'READY',
      referenceTimeZone: TRIP_TIME_ZONE,
      referenceTimeZoneSource: 'DESTINATION',
      startDate: START_DATE,
      startingPlaceId: HOME_PLACE,
    },
    update: { endDate: END_DATE, experienceRating: 5, startDate: START_DATE },
  });

  await prisma.tripDestination.upsert({
    where: { tripId_position: { position: 0, tripId: TRIP } },
    create: {
      placeId: PLACES.shibuyaSky.id,
      position: 0,
      timeZone: TRIP_TIME_ZONE,
      timeZoneResolvedAt: new Date(),
      tripId: TRIP,
    },
    update: {},
  });

  const collection: Array<[keyof typeof TRIP_PLACES, 'INTERESTED' | 'MAYBE' | 'MUST_GO' | null]> = [
    ['sensoji', 'MUST_GO'],
    ['shibuyaSky', 'MUST_GO'],
    ['hakoneRyokan', 'MUST_GO'],
    ['gionAlley', 'INTERESTED'],
    ['fushimiInari', 'MUST_GO'],
    ['narapark', 'INTERESTED'],
    ['osakaKitchen', 'MAYBE'],
  ];

  for (const [key, priority] of collection) {
    await prisma.tripPlace.upsert({
      where: { tripId_placeId: { placeId: PLACES[key].id, tripId: TRIP } },
      create: {
        id: TRIP_PLACES[key],
        note: key === 'gionAlley' ? 'Quiet after nine, worth the detour.' : null,
        placeId: PLACES[key].id,
        priority,
        tripId: TRIP,
      },
      update: { priority },
    });
  }
}

const DAY_IDS = Array.from({ length: 10 }, (_, index) => id(`4${index}`));

async function seedDays() {
  for (const [index, dayId] of DAY_IDS.entries()) {
    // Days three and four are based at the ryokan, which is what supplies their
    // timezone rather than the trip reference.
    const daysAtRyokan = index === 3 || index === 4;
    await prisma.itineraryDay.upsert({
      where: { tripId_date: { date: dayDate(index), tripId: TRIP } },
      create: {
        dailyBaseTripPlaceId: daysAtRyokan ? TRIP_PLACES.hakoneRyokan : null,
        date: dayDate(index),
        defaultTimeZone: TRIP_TIME_ZONE,
        defaultTimeZoneSource: daysAtRyokan ? 'EXPLICIT_DAILY_BASE' : 'TRIP_REFERENCE',
        defaultTimeZoneSourceTripPlaceId: daysAtRyokan ? TRIP_PLACES.hakoneRyokan : null,
        experienceNote: index === 4 ? 'Rain the whole day. Still the best onsen.' : null,
        // Deliberately uneven, and deliberately not what the overall rating averages to.
        experienceRating: [4, 5, 3, 5, 5, 4, 5, 3, 4, 2][index] ?? null,
        id: dayId,
        notes: index === 0 ? 'Land, drop bags, stay awake until dark.' : null,
        tripId: TRIP,
      },
      update: { date: dayDate(index) },
    });
  }
}

type SeedItem = {
  day: number;
  dayPart?: 'AFTERNOON' | 'ANYTIME' | 'EVENING' | 'MORNING';
  label?: string;
  localStartTime?: string;
  notes?: string;
  plannedCost?: string;
  tripPlace?: string;
};

const ITEMS: SeedItem[] = [
  { day: 0, label: 'Land at Haneda', localStartTime: '14:20' },
  { day: 0, dayPart: 'EVENING', label: 'Walk Shinjuku until we drop' },
  { day: 1, localStartTime: '08:30', notes: 'Before the crowds.', tripPlace: 'sensoji' },
  { day: 1, dayPart: 'AFTERNOON', label: 'Kappabashi kitchen street' },
  { day: 2, localStartTime: '17:45', plannedCost: '2500.00', tripPlace: 'shibuyaSky' },
  { day: 3, localStartTime: '10:00', label: 'Romancecar to Hakone' },
  { day: 3, dayPart: 'AFTERNOON', tripPlace: 'hakoneRyokan' },
  { day: 4, dayPart: 'ANYTIME', label: 'Open-air museum, slowly' },
  { day: 5, localStartTime: '09:12', label: 'Shinkansen to Kyoto' },
  { day: 5, dayPart: 'EVENING', tripPlace: 'gionAlley' },
  {
    day: 6,
    localStartTime: '07:00',
    notes: 'Walk past the busy lower gates.',
    tripPlace: 'fushimiInari',
  },
  { day: 7, dayPart: 'MORNING', tripPlace: 'narapark' },
  { day: 8, dayPart: 'EVENING', plannedCost: '4000.00', tripPlace: 'osakaKitchen' },
  { day: 9, localStartTime: '11:30', label: 'Haneda, and home' },
  // Unscheduled: never made it onto a day, which is a valid and common state.
  { day: -1, label: 'Teamlab, if there is time' },
];

async function seedItems() {
  for (const [index, item] of ITEMS.entries()) {
    const scheduled = item.day >= 0;
    const date = scheduled ? dayDate(item.day) : null;
    const startInstant =
      date && item.localStartTime ? tokyoInstant(date, item.localStartTime) : null;

    await prisma.itineraryItem.upsert({
      where: { id: id(`5${index}`) },
      create: {
        customLabel: item.label ?? null,
        dayPart: item.dayPart ?? null,
        id: id(`5${index}`),
        itineraryDayId: scheduled ? DAY_IDS[item.day] : null,
        localStartTime: item.localStartTime ? localTime(item.localStartTime) : null,
        notes: item.notes ?? null,
        plannedCostAmount: item.plannedCost ?? null,
        plannedCostCurrencyCode: item.plannedCost ? TRIP_CURRENCY : null,
        position: index,
        startInstant,
        timeSemantics: startInstant ? 'FLOATING_LOCAL' : null,
        // A scheduled item must carry a resolved timezone; an unscheduled one must not.
        timeZone: scheduled ? TRIP_TIME_ZONE : null,
        timeZoneResolvedAt: scheduled ? new Date() : null,
        timeZoneSource: scheduled ? 'DAY_DEFAULT' : null,
        travelStatus: 'COMPLETED',
        tripId: TRIP,
        tripPlaceId: item.tripPlace
          ? TRIP_PLACES[item.tripPlace as keyof typeof TRIP_PLACES]
          : null,
      },
      update: {
        itineraryDayId: scheduled ? DAY_IDS[item.day] : null,
        localStartTime: item.localStartTime ? localTime(item.localStartTime) : null,
        startInstant,
      },
    });
  }
}

async function seedSupportingRecords() {
  await prisma.reservation.upsert({
    where: { id: id('60') },
    create: {
      bookingReference: 'QF7X2M',
      flightAirline: 'Japan Airlines',
      flightArrivalAirport: 'HND',
      flightArrivalLocalDate: dayDate(0),
      flightArrivalLocalTime: localTime('14:20'),
      flightArrivalTimeZone: TRIP_TIME_ZONE,
      flightDepartureAirport: 'SIN',
      flightDepartureLocalDate: dayDate(0),
      flightDepartureLocalTime: localTime('07:05'),
      flightDepartureTimeZone: 'Asia/Singapore',
      flightNumber: 'JL38',
      flightSeat: '34A',
      id: id('60'),
      plannedCostAmount: '780.00',
      plannedCostCurrencyCode: HOME_CURRENCY,
      title: 'Singapore to Tokyo',
      tripId: TRIP,
      type: 'FLIGHT',
    },
    update: {
      flightArrivalLocalDate: dayDate(0),
      flightDepartureLocalDate: dayDate(0),
    },
  });

  await prisma.reservation.upsert({
    where: { id: id('61') },
    create: {
      accommodationAddress: 'Hakone-machi, Ashigarashimo District, Kanagawa',
      checkInDate: dayDate(3),
      checkOutDate: dayDate(5),
      id: id('61'),
      localDate: dayDate(3),
      localTime: localTime('15:00'),
      plannedCostAmount: '86000.00',
      plannedCostCurrencyCode: TRIP_CURRENCY,
      timeZone: TRIP_TIME_ZONE,
      timeZoneResolvedAt: new Date(),
      timeZoneSource: 'TRIP_PLACE',
      title: 'Hakone ryokan, two nights',
      tripId: TRIP,
      tripPlaceId: TRIP_PLACES.hakoneRyokan,
      type: 'ACCOMMODATION',
    },
    update: { checkInDate: dayDate(3), checkOutDate: dayDate(5), localDate: dayDate(3) },
  });

  for (const dayIndex of [3, 4]) {
    await prisma.reservationAccommodationDay.upsert({
      where: {
        reservationId_itineraryDayId: {
          itineraryDayId: DAY_IDS[dayIndex] ?? '',
          reservationId: id('61'),
        },
      },
      create: {
        itineraryDayId: DAY_IDS[dayIndex] ?? '',
        reservationId: id('61'),
        tripId: TRIP,
      },
      update: {},
    });
  }

  const tasks = [
    { completed: true, day: 0, label: 'Activate the JR pass' },
    { completed: true, day: 3, label: 'Forward the big bag to Kyoto' },
    { completed: false, day: 9, label: 'Claim the tax refund at the airport' },
  ];
  for (const [index, task] of tasks.entries()) {
    await prisma.task.upsert({
      where: { id: id(`7${index}`) },
      create: {
        completedAt: task.completed ? tokyoInstant(dayDate(task.day), '18:00') : null,
        dueDate: dayDate(task.day),
        dueTimeZone: TRIP_TIME_ZONE,
        dueTimeZoneResolvedAt: new Date(),
        dueTimeZoneSource: 'ITINERARY_DAY',
        id: id(`7${index}`),
        itineraryDayId: DAY_IDS[task.day],
        label: task.label,
        tripId: TRIP,
      },
      update: { dueDate: dayDate(task.day) },
    });
  }

  const info = [
    { category: 'transport', label: 'JR Pass', pinned: true, value: '7-day, collected at Haneda' },
    { category: 'money', label: 'Cash', pinned: true, value: 'Most small places are cash only' },
    {
      category: 'other',
      label: 'Ryokan house rules',
      pinned: false,
      value: 'Dinner at 18:30 sharp',
    },
  ];
  for (const [index, entry] of info.entries()) {
    await prisma.tripInfo.upsert({
      where: { id: id(`8${index}`) },
      create: {
        category: entry.category,
        id: id(`8${index}`),
        isPinned: entry.pinned,
        label: entry.label,
        tripId: TRIP,
        value: entry.value,
      },
      update: {},
    });
  }
}

const EXPENSES = [
  {
    amount: '1180.00',
    category: 'FOOD',
    day: 1,
    title: 'Breakfast near Senso-ji',
    tripPlace: 'sensoji',
  },
  {
    amount: '2500.00',
    category: 'ACTIVITIES',
    day: 2,
    title: 'Shibuya Sky',
    tripPlace: 'shibuyaSky',
  },
  { amount: '4460.00', category: 'TRANSPORT', day: 3, title: 'Romancecar, two seats' },
  {
    amount: '86000.00',
    category: 'STAY',
    day: 3,
    title: 'Ryokan, two nights',
    tripPlace: 'hakoneRyokan',
  },
  { amount: '13840.00', category: 'TRANSPORT', day: 5, title: 'Shinkansen to Kyoto' },
  {
    amount: '3200.00',
    category: 'FOOD',
    day: 5,
    title: 'Late dinner in Gion',
    tripPlace: 'gionAlley',
  },
  { amount: '900.00', category: 'SHOPPING', day: 7, title: 'Deer crackers and a fan' },
  {
    amount: '6100.00',
    category: 'FOOD',
    day: 8,
    title: 'Dotonbori, everything',
    tripPlace: 'osakaKitchen',
  },
] as const;

async function seedExpenses() {
  for (const [index, expense] of EXPENSES.entries()) {
    await prisma.expense.upsert({
      where: { id: id(`9${index}`) },
      create: {
        amount: expense.amount,
        category: expense.category,
        currencyCode: TRIP_CURRENCY,
        id: id(`9${index}`),
        itineraryDayId: DAY_IDS[expense.day],
        localDate: dayDate(expense.day),
        timeZone: TRIP_TIME_ZONE,
        timeZoneResolvedAt: new Date(),
        timeZoneSource: 'ITINERARY_DAY',
        title: expense.title,
        tripId: TRIP,
        tripPlaceId:
          'tripPlace' in expense
            ? TRIP_PLACES[expense.tripPlace as keyof typeof TRIP_PLACES]
            : null,
      },
      update: { localDate: dayDate(expense.day) },
    });
  }
}

type SeedMemory = {
  day: number;
  highlight?: boolean;
  note: string;
  time: string;
  tripPlace?: keyof typeof TRIP_PLACES;
};

const MEMORIES: SeedMemory[] = [
  {
    day: 1,
    highlight: true,
    note: 'Incense smoke and the first cold morning of the trip.',
    time: '08:52',
    tripPlace: 'sensoji',
  },
  { day: 1, note: 'Bought a knife we absolutely did not need.', time: '15:10' },
  {
    day: 2,
    highlight: true,
    note: 'The whole city went orange at once.',
    time: '18:04',
    tripPlace: 'shibuyaSky',
  },
  {
    day: 4,
    highlight: true,
    note: 'Rain on the roof, nobody else in the bath.',
    time: '21:30',
    tripPlace: 'hakoneRyokan',
  },
  {
    day: 5,
    note: 'Got lost twice and found somewhere better both times.',
    time: '20:15',
    tripPlace: 'gionAlley',
  },
  {
    day: 6,
    highlight: true,
    note: 'Walked up past the crowds until it was just us and the gates.',
    time: '07:40',
    tripPlace: 'fushimiInari',
  },
  {
    day: 8,
    note: 'Ate standing up. Best meal of the trip.',
    time: '19:25',
    tripPlace: 'osakaKitchen',
  },
  { day: 9, note: 'Already planning the next one at the gate.', time: '10:05' },
];

async function seedMemories() {
  for (const [index, memory] of MEMORIES.entries()) {
    const date = dayDate(memory.day);
    const tripPlaceId = memory.tripPlace ? TRIP_PLACES[memory.tripPlace] : null;

    await prisma.memory.upsert({
      where: { id: id(`A${index}`) },
      create: {
        capturedInstant: tokyoInstant(date, memory.time),
        capturedLocalDate: date,
        capturedLocalTime: localTime(memory.time),
        highlightPosition: memory.highlight ? index : null,
        id: id(`A${index}`),
        isHighlight: memory.highlight ?? false,
        itineraryDayId: DAY_IDS[memory.day],
        note: memory.note,
        timeZone: TRIP_TIME_ZONE,
        timeZoneSource: tripPlaceId ? 'TRIP_PLACE' : 'ITINERARY_DAY',
        tripId: TRIP,
        tripPlaceId,
      },
      update: {
        capturedInstant: tokyoInstant(date, memory.time),
        capturedLocalDate: date,
      },
    });
  }
}

async function main() {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error(
      'Set TROVE_SEED_USER_ID to your Supabase auth user UUID.\n' +
        'Find it in the Supabase dashboard under Authentication, or run:\n' +
        '  (await supabase.auth.getUser()).data.user.id  — in the browser console while signed in.',
    );
  }

  if (reset) await clearSeededTrip();

  await seedIdentity();
  await seedPlaces();
  await seedTrip();
  await seedDays();
  await seedItems();
  await seedSupportingRecords();
  await seedExpenses();
  await seedMemories();

  const start = START_DATE.toISOString().slice(0, 10);
  const end = END_DATE.toISOString().slice(0, 10);
  console.log(`Seeded "Japan in autumn" (${start} to ${end}) for ${userId}.`);
  console.log(
    'Memory photos are not seeded — add a few through the UI to see the Trip Story cover.',
  );
}

await main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
