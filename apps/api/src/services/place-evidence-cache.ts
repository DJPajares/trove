import { getPrismaClient, Prisma } from '@trove/db';
import { z } from 'zod';
import { normalizePlaceLanguageCode } from './place-language.js';
import type { PlaceDetailsRequest, PlaceDetailsResult, ProviderPlaceDetails } from './places.js';

/** Accepted bounded retention policy. Acquiring or reusing evidence never extends its age. */
export const PLACE_EVIDENCE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const point = z.object({
  day: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  date: z.string().optional(),
});
const periods = z.array(z.object({ open: point, close: point.nullable() }));
const evidenceSchema = z.object({
  attributions: z.array(z.object({ provider: z.string(), providerUri: z.string().nullable() })),
  category: z.enum([
    'destination',
    'things_to_do',
    'food_and_drink',
    'stay',
    'shopping',
    'transport',
    'other',
  ]),
  externalPlaceId: z.string(),
  formattedAddress: z.string().nullable(),
  googleMapsUri: z.string().nullable(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).nullable(),
  name: z.string(),
  openingPeriods: periods,
  primaryType: z.string().nullable(),
  provider: z.literal('google'),
  rating: z.number().min(0).max(5).nullable(),
  rawTypes: z.array(z.string()),
  utcOffsetMinutes: z.number().nullable(),
  userRatingCount: z.number().int().nonnegative().nullable().optional(),
  openingHoursDescriptions: z.array(z.string()).optional(),
  currentOpeningPeriods: periods.optional(),
  currentHoursValidFrom: z.string().nullable().optional(),
  currentHoursValidThrough: z.string().nullable().optional(),
  // Optional because evidence stored before photos were asked for has none;
  // that absence is what tells an opened sheet to acquire them once.
  photos: z
    .array(
      z.object({
        authorAttributions: z.array(
          z.object({ displayName: z.string(), uri: z.string().nullable() }),
        ),
        heightPx: z.number().int().positive().nullable(),
        name: z.string(),
        uri: z.string().nullable(),
        widthPx: z.number().int().positive().nullable(),
      }),
    )
    .max(3)
    .optional(),
  websiteUri: z.string().nullable().optional(),
  internationalPhoneNumber: z.string().nullable().optional(),
  priceLevel: z
    .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .nullable()
    .optional(),
});

/** No provider construction, callbacks or refresh-on-miss path. */
export async function readCachedPlaceEvidence(
  request: Omit<PlaceDetailsRequest, 'detail'>,
  now = new Date(),
  options: { languageIndependent?: boolean } = {},
): Promise<Extract<PlaceDetailsResult, { status: 'ok' }> | null> {
  try {
    const row = await getPrismaClient().placeProviderRef.findUnique({
      where: {
        provider_externalPlaceId: { provider: 'GOOGLE', externalPlaceId: request.externalPlaceId },
      },
    });
    if (
      !options.languageIndependent &&
      (row?.cachedEvidenceRegion?.toLowerCase() ?? '') !== (request.regionCode?.toLowerCase() ?? '')
    )
      return null;
    if (
      !row?.cachedEvidenceAt ||
      (!options.languageIndependent &&
        normalizePlaceLanguageCode(row.cachedEvidenceLanguage) !==
          normalizePlaceLanguageCode(request.languageCode))
    )
      return null;
    const age = now.getTime() - row.cachedEvidenceAt.getTime();
    if (age < 0 || age >= PLACE_EVIDENCE_TTL_MS) return null;
    const parsed = evidenceSchema.safeParse(row.cachedEvidence);
    if (!parsed.success || parsed.data.externalPlaceId !== request.externalPlaceId) return null;
    return {
      status: 'ok',
      provider: 'google',
      freshness: { fetchedAt: row.cachedEvidenceAt.toISOString(), source: 'cache' },
      place: parsed.data,
    };
  } catch {
    return null;
  }
}

export async function storePlaceEvidence(
  request: Omit<PlaceDetailsRequest, 'detail'>,
  result: Extract<PlaceDetailsResult, { status: 'ok' }>,
) {
  const fetchedAt = new Date(result.freshness.fetchedAt);
  if (
    !Number.isFinite(fetchedAt.getTime()) ||
    result.place.externalPlaceId !== request.externalPlaceId
  )
    return;
  const parsed = evidenceSchema.safeParse(result.place);
  if (!parsed.success) return;
  try {
    await getPrismaClient().placeProviderRef.updateMany({
      where: {
        provider: 'GOOGLE',
        externalPlaceId: request.externalPlaceId,
        // Re-seeding the same acquisition must not erase subsequently resolved photos.
        OR: [{ cachedEvidenceAt: null }, { cachedEvidenceAt: { lt: fetchedAt } }],
      },
      data: {
        cachedEvidence: parsed.data as Prisma.InputJsonValue,
        cachedEvidenceAt: fetchedAt,
        cachedEvidenceRegion: request.regionCode?.toLowerCase() ?? null,
        cachedEvidenceLanguage: normalizePlaceLanguageCode(request.languageCode),
      },
    });
  } catch {
    /* Evidence persistence must never fail ordinary planning. */
  }
}

/** Update one photo in place, preserving concurrent URLs and the snapshot's original age. */
export async function storePlacePhotoUri(
  request: Omit<PlaceDetailsRequest, 'detail'>,
  fetchedAt: string,
  photoName: string,
  uri: string,
): Promise<ProviderPlaceDetails | null> {
  try {
    const rows = await getPrismaClient().$queryRaw<Array<{ evidence: unknown }>>(Prisma.sql`
      UPDATE trove.place_provider_refs
      SET cached_evidence = jsonb_set(cached_evidence, (
        SELECT ARRAY['photos', (ordinality - 1)::text, 'uri']
        FROM jsonb_array_elements(cached_evidence->'photos') WITH ORDINALITY
        WHERE value->>'name' = ${photoName}
        LIMIT 1
      ), to_jsonb(${uri}::text), false)
      WHERE provider = 'google'
        AND external_place_id = ${request.externalPlaceId}
        AND cached_evidence_at = ${new Date(fetchedAt)}
        AND COALESCE(lower(cached_evidence_language), 'en') = ${normalizePlaceLanguageCode(request.languageCode).toLowerCase()}
        AND COALESCE(lower(cached_evidence_region), '') = ${request.regionCode?.toLowerCase() ?? ''}
        AND cached_evidence->'photos' @> ${JSON.stringify([{ name: photoName }])}::jsonb
      RETURNING cached_evidence AS evidence
    `);
    const parsed = evidenceSchema.safeParse(rows[0]?.evidence);
    return parsed.success ? parsed.data : null;
  } catch {
    // Retain process-local reuse when persistence is unavailable.
    return null;
  }
}
