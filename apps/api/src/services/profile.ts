import type { SupabaseClient } from '@supabase/supabase-js';
import { getPrismaClient } from '@trove/db';

import { createAuthenticatedSupabaseClient } from './supabase-auth.js';

export const PROFILE_PHOTOS_BUCKET = 'profile-photos';

export type ProfileUpdate = {
  appearance?: 'dark' | 'light' | 'system' | null;
  avatarPath?: string | null;
  dateFormat?: 'dmy' | 'mdy' | 'ymd' | null;
  displayName?: string | null;
  distanceUnit?: 'km' | 'mi' | null;
  homeCurrencyCode?: string | null;
  homeLocation?: string | null;
  temperatureUnit?: 'celsius' | 'fahrenheit' | null;
  timeFormat?: '12h' | '24h' | null;
};

type ProfileRecord = Awaited<ReturnType<typeof findOrCreateProfile>>;

function mapProfileValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const values: Record<string, string> = {
    DARK: 'dark',
    DAY_MONTH_YEAR: 'dmy',
    FAHRENHEIT: 'fahrenheit',
    HOUR_12: '12h',
    HOUR_24: '24h',
    KILOMETERS: 'km',
    LIGHT: 'light',
    MILES: 'mi',
    MONTH_DAY_YEAR: 'mdy',
    SYSTEM: 'system',
    YEAR_MONTH_DAY: 'ymd',
    CELSIUS: 'celsius',
  };

  return values[value] ?? null;
}

async function findOrCreateProfile(userId: string) {
  const prisma = getPrismaClient();

  return prisma.profile.upsert({
    where: { id: userId },
    create: { id: userId },
    update: {},
    include: { homePlace: true },
  });
}

async function createAvatarUrl(supabase: SupabaseClient | null, avatarPath: string | null) {
  if (!supabase || !avatarPath) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(PROFILE_PHOTOS_BUCKET)
    .createSignedUrl(avatarPath, 60 * 60);

  return error ? null : data.signedUrl;
}

function serializeProfile(profile: ProfileRecord, avatarUrl: string | null) {
  return {
    appearance: mapProfileValue(profile.appearance),
    avatarPath: profile.avatarPath,
    avatarUrl,
    dateFormat: mapProfileValue(profile.dateFormat),
    displayName: profile.displayName,
    distanceUnit: mapProfileValue(profile.distanceUnit),
    homeCurrencyCode: profile.homeCurrencyCode?.trim() || null,
    homeLocation: profile.homePlace?.customName ?? null,
    id: profile.id,
    temperatureUnit: mapProfileValue(profile.temperatureUnit),
    timeFormat: mapProfileValue(profile.timeFormat),
  };
}

export async function getProfile(userId: string, accessToken: string) {
  const profile = await findOrCreateProfile(userId);
  const supabase = createAuthenticatedSupabaseClient(accessToken);
  const avatarUrl = await createAvatarUrl(supabase, profile.avatarPath);

  return serializeProfile(profile, avatarUrl);
}

export async function updateProfile(userId: string, accessToken: string, changes: ProfileUpdate) {
  const prisma = getPrismaClient();
  await prisma.profile.upsert({
    where: { id: userId },
    create: { id: userId },
    update: {},
  });

  const profile = await prisma.$transaction(async (transaction) => {
    const homeLocation = changes.homeLocation?.trim() || null;
    let homePlaceId: string | null | undefined;

    if (changes.homeLocation !== undefined) {
      if (!homeLocation) {
        homePlaceId = null;
      } else {
        const existingPlace = await transaction.place.findFirst({
          where: {
            customName: homeLocation,
            kind: 'CUSTOM',
            ownerId: userId,
          },
        });

        const homePlace =
          existingPlace ??
          (await transaction.place.create({
            data: {
              customName: homeLocation,
              kind: 'CUSTOM',
              ownerId: userId,
            },
          }));

        homePlaceId = homePlace.id;
      }
    }

    return transaction.profile.upsert({
      where: { id: userId },
      create: {
        appearance: changes.appearance?.toUpperCase() as 'DARK' | 'LIGHT' | 'SYSTEM' | undefined,
        avatarPath: changes.avatarPath,
        dateFormat: changes.dateFormat
          ? changes.dateFormat === 'dmy'
            ? 'DAY_MONTH_YEAR'
            : changes.dateFormat === 'ymd'
              ? 'YEAR_MONTH_DAY'
              : 'MONTH_DAY_YEAR'
          : undefined,
        displayName: changes.displayName,
        distanceUnit:
          changes.distanceUnit === 'km'
            ? 'KILOMETERS'
            : changes.distanceUnit === 'mi'
              ? 'MILES'
              : undefined,
        homeCurrencyCode: changes.homeCurrencyCode,
        homePlaceId,
        temperatureUnit:
          changes.temperatureUnit === 'celsius'
            ? 'CELSIUS'
            : changes.temperatureUnit === 'fahrenheit'
              ? 'FAHRENHEIT'
              : undefined,
        timeFormat:
          changes.timeFormat === '12h'
            ? 'HOUR_12'
            : changes.timeFormat === '24h'
              ? 'HOUR_24'
              : undefined,
      },
      update: {
        ...(changes.appearance !== undefined
          ? { appearance: changes.appearance ? changes.appearance.toUpperCase() : null }
          : {}),
        ...(changes.avatarPath !== undefined ? { avatarPath: changes.avatarPath } : {}),
        ...(changes.dateFormat !== undefined
          ? {
              dateFormat:
                changes.dateFormat === null
                  ? null
                  : changes.dateFormat === 'dmy'
                    ? 'DAY_MONTH_YEAR'
                    : changes.dateFormat === 'ymd'
                      ? 'YEAR_MONTH_DAY'
                      : 'MONTH_DAY_YEAR',
            }
          : {}),
        ...(changes.displayName !== undefined ? { displayName: changes.displayName } : {}),
        ...(changes.distanceUnit !== undefined
          ? {
              distanceUnit:
                changes.distanceUnit === null
                  ? null
                  : changes.distanceUnit === 'km'
                    ? 'KILOMETERS'
                    : 'MILES',
            }
          : {}),
        ...(changes.homeCurrencyCode !== undefined
          ? { homeCurrencyCode: changes.homeCurrencyCode }
          : {}),
        ...(homePlaceId !== undefined ? { homePlaceId } : {}),
        ...(changes.temperatureUnit !== undefined
          ? {
              temperatureUnit:
                changes.temperatureUnit === null
                  ? null
                  : changes.temperatureUnit === 'celsius'
                    ? 'CELSIUS'
                    : 'FAHRENHEIT',
            }
          : {}),
        ...(changes.timeFormat !== undefined
          ? {
              timeFormat:
                changes.timeFormat === null
                  ? null
                  : changes.timeFormat === '12h'
                    ? 'HOUR_12'
                    : 'HOUR_24',
            }
          : {}),
      },
      include: { homePlace: true },
    });
  });

  const supabase = createAuthenticatedSupabaseClient(accessToken);
  const avatarUrl = await createAvatarUrl(supabase, profile.avatarPath);

  return serializeProfile(profile, avatarUrl);
}
