import type { SupabaseClient } from '@supabase/supabase-js';
import { getPrismaClient } from '@trove/db';
import { timeZoneForCountry } from '@trove/types';

import { MEMORY_PHOTOS_BUCKET } from './memories.js';
import { createAuthenticatedSupabaseClient } from './supabase-auth.js';

export const PROFILE_PHOTOS_BUCKET = 'profile-photos';

/** A cover photo that is not one of the traveller's own Memory photos. */
export class InvalidCoverPhotoError extends Error {
  constructor() {
    super('invalid_cover_photo');
    this.name = 'InvalidCoverPhotoError';
  }
}

/** A home country Trove has no time zone for, which the request schema rejects first. */
export class UnknownCountryError extends Error {
  constructor() {
    super('unknown_country_code');
    this.name = 'UnknownCountryError';
  }
}

export type ProfileAppearance = 'dark' | 'light';

export type ProfileUpdate = {
  appearance?: ProfileAppearance | null;
  avatarPath?: string | null;
  bio?: string | null;
  coverMemoryPhotoId?: string | null;
  dateFormat?: 'dmy' | 'mdy' | 'ymd' | null;
  displayName?: string | null;
  distanceUnit?: 'km' | 'mi' | null;
  homeCountryCode?: string | null;
  homeCurrencyCode?: string | null;
  temperatureUnit?: 'celsius' | 'fahrenheit' | null;
  timeFormat?: '12h' | '24h' | null;
  travelStyles?: string[];
};

type ProfileRecord = Awaited<ReturnType<typeof findOrCreateProfile>>;

type ProfilePersistenceUpdate = {
  appearance?: 'DARK' | 'LIGHT' | null;
  avatarPath?: string | null;
  bio?: string | null;
  coverMemoryPhotoId?: string | null;
  dateFormat?: 'DAY_MONTH_YEAR' | 'MONTH_DAY_YEAR' | 'YEAR_MONTH_DAY' | null;
  displayName?: string | null;
  distanceUnit?: 'KILOMETERS' | 'MILES' | null;
  homeCountryCode?: string | null;
  homeCurrencyCode?: string | null;
  homeTimeZone?: string | null;
  temperatureUnit?: 'CELSIUS' | 'FAHRENHEIT' | null;
  timeFormat?: 'HOUR_12' | 'HOUR_24' | null;
  travelStyles?: string[];
};

const coverPhotoInclude = {
  coverMemoryPhoto: { select: { contentType: true, id: true, path: true } },
} as const;

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
    include: coverPhotoInclude,
  });
}

/**
 * The profile's cover, signed like every other Memory photograph. A photo
 * whose link cannot be made is left out rather than sent broken; the profile
 * falls back to its own choice of cover.
 */
async function createCoverPhoto(
  supabase: SupabaseClient | null,
  photo: ProfileRecord['coverMemoryPhoto'],
) {
  if (!supabase || !photo) return null;

  const { data, error } = await supabase.storage
    .from(MEMORY_PHOTOS_BUCKET)
    .createSignedUrl(photo.path, 60 * 60);

  return error || !data
    ? null
    : { contentType: photo.contentType, id: photo.id, url: data.signedUrl };
}

/** Trims, drops empties and repeats (ignoring case), keeping the traveller's order. */
export function normalizeTravelStyles(styles: readonly string[]) {
  const seen = new Set<string>();
  return styles.flatMap((style) => {
    const value = style.trim().replace(/\s+/g, ' ');
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return [];
    seen.add(key);
    return [value];
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

function serializeProfile(
  profile: ProfileRecord,
  avatarUrl: string | null,
  coverPhoto: Awaited<ReturnType<typeof createCoverPhoto>>,
) {
  return {
    appearance: mapProfileValue(profile.appearance),
    avatarPath: profile.avatarPath,
    avatarUrl,
    bio: profile.bio?.trim() || null,
    coverPhoto,
    dateFormat: mapProfileValue(profile.dateFormat),
    displayName: profile.displayName,
    distanceUnit: mapProfileValue(profile.distanceUnit),
    homeCountryCode: profile.homeCountryCode?.trim() || null,
    homeCurrencyCode: profile.homeCurrencyCode?.trim() || null,
    homeTimeZone: profile.homeTimeZone,
    id: profile.id,
    temperatureUnit: mapProfileValue(profile.temperatureUnit),
    timeFormat: mapProfileValue(profile.timeFormat),
    travelStyles: profile.travelStyles,
  };
}

export async function getProfile(userId: string, accessToken: string) {
  const profile = await findOrCreateProfile(userId);
  const supabase = createAuthenticatedSupabaseClient(accessToken);
  const [avatarUrl, coverPhoto] = await Promise.all([
    createAvatarUrl(supabase, profile.avatarPath),
    createCoverPhoto(supabase, profile.coverMemoryPhoto),
  ]);

  return serializeProfile(profile, avatarUrl, coverPhoto);
}

export async function updateProfile(userId: string, accessToken: string, changes: ProfileUpdate) {
  const prisma = getPrismaClient();
  await prisma.profile.upsert({
    where: { id: userId },
    create: { id: userId },
    update: {},
  });

  // A home country is only ever stored alongside the zone it implies, so the
  // two can never disagree and no reader has to resolve one from the other.
  const homeCountry =
    changes.homeCountryCode === undefined
      ? undefined
      : (() => {
          const code = changes.homeCountryCode?.trim().toUpperCase() || null;
          if (!code) return { homeCountryCode: null, homeTimeZone: null };

          const timeZone = timeZoneForCountry(code);
          if (!timeZone) throw new UnknownCountryError();

          return { homeCountryCode: code, homeTimeZone: timeZone };
        })();

  // A cover must be a photograph from one of the traveller's own trips.
  if (changes.coverMemoryPhotoId) {
    const owned = await prisma.memoryPhoto.count({
      where: { id: changes.coverMemoryPhotoId, memory: { trip: { ownerId: userId } } },
    });
    if (!owned) throw new InvalidCoverPhotoError();
  }

  const profileUpdate: ProfilePersistenceUpdate = {
    ...(changes.appearance !== undefined
      ? { appearance: changes.appearance === null ? null : toAppearance(changes.appearance) }
      : {}),
    ...(changes.avatarPath !== undefined ? { avatarPath: changes.avatarPath } : {}),
    ...(changes.bio !== undefined ? { bio: changes.bio?.trim() || null } : {}),
    ...(changes.coverMemoryPhotoId !== undefined
      ? { coverMemoryPhotoId: changes.coverMemoryPhotoId }
      : {}),
    ...(changes.travelStyles !== undefined
      ? { travelStyles: normalizeTravelStyles(changes.travelStyles) }
      : {}),
    ...(changes.dateFormat !== undefined
      ? { dateFormat: changes.dateFormat === null ? null : toDateFormat(changes.dateFormat) }
      : {}),
    ...(changes.displayName !== undefined ? { displayName: changes.displayName } : {}),
    ...(changes.distanceUnit !== undefined
      ? {
          distanceUnit: changes.distanceUnit === null ? null : toDistanceUnit(changes.distanceUnit),
        }
      : {}),
    ...homeCountry,
    ...(changes.homeCurrencyCode !== undefined
      ? { homeCurrencyCode: changes.homeCurrencyCode }
      : {}),
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

  const profile = await prisma.profile.update({
    where: { id: userId },
    data: profileUpdate,
    include: coverPhotoInclude,
  });

  const supabase = createAuthenticatedSupabaseClient(accessToken);
  const [avatarUrl, coverPhoto] = await Promise.all([
    createAvatarUrl(supabase, profile.avatarPath),
    createCoverPhoto(supabase, profile.coverMemoryPhoto),
  ]);

  return serializeProfile(profile, avatarUrl, coverPhoto);
}
