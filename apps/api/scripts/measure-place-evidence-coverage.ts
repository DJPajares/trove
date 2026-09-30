import { getPrismaClient } from '@trove/db';

import {
  mergeCoverage,
  share,
  summariseCoverage,
  type EvidenceRow,
  type PopulationCoverage,
} from '../src/services/evidence-coverage.js';

/**
 * Read-only: counts how many of each trip's places have fresh stored rating and
 * hours evidence. Makes no writes and no provider requests, so it is safe to
 * point at any database.
 */

const refSelect = {
  where: { provider: 'GOOGLE' as const },
  select: { cachedEvidence: true, cachedEvidenceAt: true },
  take: 1,
};

type Place = { providerRefs: Array<{ cachedEvidence: unknown; cachedEvidenceAt: Date | null }> };

/** Custom Places have no provider reference and nothing to measure. */
function rowOf(place: Place): EvidenceRow[] {
  const reference = place.providerRefs[0];
  return reference
    ? [{ evidence: reference.cachedEvidence, evidenceAt: reference.cachedEvidenceAt }]
    : [];
}

function line(label: string, c: PopulationCoverage) {
  return [
    label.padEnd(20),
    String(c.total).padStart(5),
    share(c.withFreshEvidence, c.total).padStart(12),
    share(c.withHours, c.total).padStart(12),
    share(c.withDateSpecificHours, c.total).padStart(12),
    share(c.withRating, c.total).padStart(12),
  ].join(' ');
}

async function main() {
  const prisma = getPrismaClient();
  const now = new Date();
  try {
    const trips = await prisma.trip.findMany({
      orderBy: { startDate: 'asc' },
      select: {
        itineraryDays: {
          select: {
            items: {
              select: { tripPlace: { select: { place: { select: { providerRefs: refSelect } } } } },
              where: { tripPlaceId: { not: null } },
            },
          },
        },
        name: true,
        tripPlaces: { select: { place: { select: { providerRefs: refSelect } } } },
      },
    });
    const saved = await prisma.savedPlace.findMany({
      select: { place: { select: { providerRefs: refSelect } } },
    });

    const header = `${'population'.padEnd(20)} ${'places'.padStart(5)} ${'fresh'.padStart(12)} ${'hours'.padStart(12)} ${'date hours'.padStart(12)} ${'rating'.padStart(12)}`;
    const tripPlaces: PopulationCoverage[] = [];
    const scheduled: PopulationCoverage[] = [];

    console.log(header);
    for (const trip of trips) {
      const places = summariseCoverage(
        trip.tripPlaces.flatMap((entry) => rowOf(entry.place)),
        now,
      );
      const items = summariseCoverage(
        trip.itineraryDays.flatMap((day) =>
          day.items.flatMap((item) => (item.tripPlace ? rowOf(item.tripPlace.place) : [])),
        ),
        now,
      );
      tripPlaces.push(places);
      scheduled.push(items);
      console.log(line(`${trip.name.slice(0, 15)} places`, places));
      console.log(line(`${trip.name.slice(0, 15)} items`, items));
    }

    console.log(`\n${header}`);
    console.log(line('All Trip Places', mergeCoverage(tripPlaces)));
    console.log(line('All scheduled items', mergeCoverage(scheduled)));
    console.log(
      line(
        'Saved Places',
        summariseCoverage(
          saved.flatMap((entry) => rowOf(entry.place)),
          now,
        ),
      ),
    );
    console.log(
      '\nPlaces with a Google reference only. "fresh" = evidence acquired in the last 30 days.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Evidence coverage report failed.');
  process.exitCode = 1;
});
