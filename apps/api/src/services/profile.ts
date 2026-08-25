import type { SupabaseClient } from '@supabase/supabase-js';
import { getPrismaClient } from '@trove/db';

import { createAuthenticatedSupabaseClient } from './supabase-auth.js';

export const PROFILE_PHOTOS_BUCKET = 'profile-photos';

export type ProfileAppearance = 'dark' | 'light';

export type ProfileUpdate = {
  appearance?: ProfileAppearance | null;
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

type ProfilePersistenceUpdate = {
  appearance?: 'DARK' | 'LIGHT' | null;
  avatarPath?: string | null;
  dateFormat?: 'DAY_MONTH_YEAR' | 'MONTH_DAY_YEAR' | 'YEAR_MONTH_DAY' | null;
  displayName?: string | null;
  distanceUnit?: 'KILOMETERS' | 'MILES' | null;
  homeCurrencyCode?: string | null;
  homePlaceId?: string | null;
  temperatureUnit?: 'CELSIUS' | 'FAHRENHEIT' | null;
  timeFormat?: 'HOUR_12' | 'HOUR_24' | null;
};

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
    YEAR_MONTH_DAY: 'ymd',
    CELSIUS: 'celsius',
  };

  return values[value] ?? null;
}

function toAppearance(value: Exclude<ProfileUpdate['appearance'], null | undefined>) {
  return value === 'dark' ? 'DARK' : 'LIGHT';
}

/** Old PWA clients may still submit System after the database value is removed. */
export function normalizeLegacyAppearance(
  appearance: ProfileAppearance | 'system',
): ProfileAppearance {
  return appearance === 'system' ? 'light' : appearance;
}

function toDateFormat(value: Exclude<ProfileUpdate['dateFormat'], null | undefined>) {
  return value === 'dmy' ? 'DAY_MONTH_YEAR' : value === 'ymd' ? 'YEAR_MONTH_DAY' : 'MONTH_DAY_YEAR';
}

function toDistanceUnit(value: Exclude<ProfileUpdate['distanceUnit'], null | undefined>) {
  return value === 'km' ? 'KILOMETERS' : 'MILES';
}

function toTemperatureUnit(value: Exclude<ProfileUpdate['temperatureUnit'], null | undefined>) {
  return value === 'celsius' ? 'CELSIUS' : 'FAHRENHEIT';
}

function toTimeFormat(value: Exclude<ProfileUpdate['timeFormat'], null | undefined>) {
  return value === '12h' ? 'HOUR_12' : 'HOUR_24';
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

    const profileUpdate: ProfilePersistenceUpdate = {
      ...(changes.appearance !== undefined
        ? { appearance: changes.appearance === null ? null : toAppearance(changes.appearance) }
        : {}),
      ...(changes.avatarPath !== undefined ? { avatarPath: changes.avatarPath } : {}),
      ...(changes.dateFormat !== undefined
        ? { dateFormat: changes.dateFormat === null ? null : toDateFormat(changes.dateFormat) }
        : {}),
      ...(changes.displayName !== undefined ? { displayName: changes.displayName } : {}),
      ...(changes.distanceUnit !== undefined
        ? {
            distanceUnit:
              changes.distanceUnit === null ? null : toDistanceUnit(changes.distanceUnit),
          }
        : {}),
      ...(changes.homeCurrencyCode !== undefined
        ? { homeCurrencyCode: changes.homeCurrencyCode }
        : {}),
      ...(homePlaceId !== undefined ? { homePlaceId } : {}),
      ...(changes.temperatureUnit !== undefined
        ? {
            temperatureUnit:
              changes.temperatureUnit === null ? null : toTemperatureUnit(changes.temperatureUnit),
          }
        : {}),
      ...(changes.timeFormat !== undefined
        ? { timeFormat: changes.timeFormat === null ? null : toTimeFormat(changes.timeFormat) }
        : {}),
    };

    return transaction.profile.update({
      where: { id: userId },
      data: profileUpdate,
      include: { homePlace: true },
    });
  });

  const supabase = createAuthenticatedSupabaseClient(accessToken);
  const avatarUrl = await createAvatarUrl(supabase, profile.avatarPath);

  return serializeProfile(profile, avatarUrl);
}
