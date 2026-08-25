import { getAllCountries } from 'countries-and-timezones';

import { categorizePlaceTypes } from './place-categories.js';
import { normalizeEditorialSubjectText, type EditorialImageSubject } from './editorial-images.js';
import type { TrovePlaceCategory } from './places.js';

const MAX_EDITORIAL_QUERY_LENGTH = 180;

const CATEGORY_QUERY_TERMS: Record<TrovePlaceCategory, string> = {
  destination: 'travel destination',
  food_and_drink: 'restaurant',
  other: 'travel place',
  shopping: 'shopping',
  stay: 'hotel',
  things_to_do: 'landmark',
  transport: 'station',
};

const UNHELPFUL_PLACE_TYPES = new Set([
  'establishment',
  'food',
  'general_contractor',
  'lodging',
  'place_of_worship',
  'point_of_interest',
  'premise',
]);

const PLACE_NAME_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'de',
  'del',
  'for',
  'in',
  'la',
  'le',
  'of',
  'on',
  'the',
]);

const AMBIGUOUS_PLACE_TOKENS = new Set([
  'airport',
  'bakery',
  'bar',
  'cafe',
  'central',
  'grand',
  'hotel',
  'main',
  'market',
  'museum',
  'new',
  'old',
  'park',
  'place',
  'restaurant',
  'shop',
  'station',
  'store',
]);

/** Business suffixes describe an offering, not the landmark a photograph depicts. */
const PLACE_NAME_MODIFIER_TOKENS = new Set([
  'adventure',
  'adventures',
  'experience',
  'experiences',
  'guided',
  'tour',
  'tours',
  'visit',
  'visits',
]);

const PEXELS_LOCALES: Record<string, string> = {
  ca: 'ca-ES',
  cs: 'cs-CZ',
  da: 'da-DK',
  de: 'de-DE',
  el: 'el-GR',
  en: 'en-US',
  es: 'es-ES',
  fi: 'fi-FI',
  fr: 'fr-FR',
  hu: 'hu-HU',
  id: 'id-ID',
  it: 'it-IT',
  ja: 'ja-JP',
  ko: 'ko-KR',
  nb: 'nb-NO',
  nl: 'nl-NL',
  pl: 'pl-PL',
  pt: 'pt-BR',
  ro: 'ro-RO',
  ru: 'ru-RU',
  sk: 'sk-SK',
  sv: 'sv-SE',
  th: 'th-TH',
  tr: 'tr-TR',
  uk: 'uk-UA',
  vi: 'vi-VN',
  zh: 'zh-CN',
};

function normalizedTokens(value: string) {
  return normalizeEditorialSubjectText(value)
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const COUNTRY_CODES_BY_NAME = new Map(
  Object.values(getAllCountries()).map((country) => [
    normalizedTokens(country.name).join(' '),
    country.id,
  ]),
);

for (const [name, countryCode] of [
  ['america', 'US'],
  ['england', 'GB'],
  ['great britain', 'GB'],
  ['scotland', 'GB'],
  ['united states', 'US'],
  ['usa', 'US'],
  ['wales', 'GB'],
] as const) {
  COUNTRY_CODES_BY_NAME.set(name, countryCode);
}

type EditorialPhotoEvidence = {
  altText?: string | null;
  description?: string | null;
  metadata?: readonly (string | null | undefined)[];
  name?: string | null;
  providerPageUrl?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
};

function tokenVariants(token: string) {
  if (token.endsWith('ies') && token.length > 4) return [token, `${token.slice(0, -3)}y`];
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return [token, token.slice(0, -1)];
  }

  return [token];
}

function evidenceContainsToken(evidenceTokens: ReadonlySet<string>, token: string) {
  return tokenVariants(token).some((variant) => evidenceTokens.has(variant));
}

function expectedCountry(address: string | null | undefined) {
  const candidate = address?.split(',').at(-1);
  if (!candidate) return null;

  const name = normalizedTokens(candidate).join(' ');
  const code = COUNTRY_CODES_BY_NAME.get(name);

  return code ? { code, tokens: normalizedTokens(candidate) } : null;
}

function countriesMentioned(tokens: string[]) {
  const phrase = ` ${tokens.join(' ')} `;
  const matches: Array<{ code: string; end: number; start: number }> = [];

  for (const [name, code] of COUNTRY_CODES_BY_NAME) {
    const start = phrase.indexOf(` ${name} `);
    if (start === -1) continue;

    matches.push({ code, end: start + name.length + 2, start });
  }

  return new Set(
    matches
      .filter(
        (match) =>
          !matches.some(
            (other) =>
              other !== match &&
              other.start <= match.start &&
              other.end >= match.end &&
              other.end - other.start > match.end - match.start,
          ),
      )
      .map((match) => match.code),
  );
}

function addressLocality(address: string | null | undefined) {
  const pieces = address
    ?.split(',')
    .map((piece) => piece.trim())
    .filter(Boolean);

  if (!pieces?.length) return '';

  const locality = pieces.length > 1 ? pieces.slice(1) : pieces;

  return locality
    .join(' ')
    .replace(/\b[\p{Number}-]{3,}\b/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMeaningfulType(type: string | null | undefined, category: TrovePlaceCategory) {
  if (!type || UNHELPFUL_PLACE_TYPES.has(type)) return false;
  if (category === 'other') return true;

  return categorizePlaceTypes([type], type) === category;
}

/** The narrowest useful type the traveller has already resolved, never a new provider lookup. */
export function detailedEditorialPlaceType(subject: EditorialImageSubject) {
  const category = subject.category ?? 'destination';
  const types = [subject.primaryType, ...(subject.rawTypes ?? [])];

  return types.find((type): type is string => isMeaningfulType(type, category)) ?? null;
}

export function genericEditorialSubject(subject: EditorialImageSubject): EditorialImageSubject {
  const category = subject.category ?? 'destination';
  const type = detailedEditorialPlaceType(subject);

  return {
    category,
    kind: 'generic',
    name: type ? type.replace(/_/g, ' ') : CATEGORY_QUERY_TERMS[category],
    primaryType: type,
  };
}

function appendUniquePart(parts: string[], value: string | null | undefined) {
  const clean = value?.trim().replace(/\s+/g, ' ');
  if (!clean) return;

  const normalized = normalizeEditorialSubjectText(clean);
  if (parts.some((part) => normalizeEditorialSubjectText(part) === normalized)) return;

  parts.push(clean);
}

/** Pexels supports keywords, not coordinates or Google Place identifiers. */
export function buildEditorialSearchQuery(subject: EditorialImageSubject) {
  const parts: string[] = [];
  appendUniquePart(parts, subject.name);

  if (subject.kind !== 'generic') {
    appendUniquePart(parts, addressLocality(subject.address));
    appendUniquePart(parts, detailedEditorialPlaceType(subject)?.replace(/_/g, ' '));
  }

  const categoryTerm = CATEGORY_QUERY_TERMS[subject.category ?? 'destination'];
  const existingTokens = new Set(normalizedTokens(parts.join(' ')));
  if (!normalizedTokens(categoryTerm).every((token) => existingTokens.has(token))) {
    appendUniquePart(parts, categoryTerm);
  }

  let query = '';
  for (const part of parts) {
    const candidate = query ? `${query} ${part}` : part;
    if (candidate.length > MAX_EDITORIAL_QUERY_LENGTH) break;
    query = candidate;
  }

  return query || subject.name.trim().slice(0, MAX_EDITORIAL_QUERY_LENGTH);
}

export function supportedEditorialLocale(languageCode: string | null | undefined) {
  if (!languageCode) return undefined;

  const normalized = languageCode.trim().replace(/_/g, '-');
  const exact = Object.values(PEXELS_LOCALES).find(
    (locale) => locale.toLowerCase() === normalized.toLowerCase(),
  );

  return exact ?? PEXELS_LOCALES[normalized.split('-')[0]?.toLowerCase() ?? ''];
}

function photoPath(value: string | null | undefined) {
  if (value) {
    try {
      return decodeURIComponent(new URL(value).pathname).replace(/-\d+\/?$/, '');
    } catch {
      return '';
    }
  }

  return '';
}

function photoDescription(photo: EditorialPhotoEvidence) {
  return normalizedTokens(
    [
      photo.altText,
      photo.description,
      photo.name,
      photo.title,
      ...(photo.metadata ?? []),
      photoPath(photo.providerPageUrl),
      photoPath(photo.sourceUrl),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

/**
 * Provider text can identify a landmark without reproducing every business
 * suffix. Country/locality corroborates abbreviated names, while a conflicting
 * country rules out an otherwise convincing namesake.
 */
export function editorialMatchScore(subject: EditorialImageSubject, photo: EditorialPhotoEvidence) {
  if (subject.kind === 'generic') return 1;

  const nameTokens = normalizedTokens(subject.name).filter(
    (token) => !PLACE_NAME_STOP_WORDS.has(token),
  );
  if (!nameTokens.length) return 0;

  const evidence = photoDescription(photo);
  const evidenceTokens = new Set(evidence.flatMap(tokenVariants));
  const coreNameTokens = nameTokens.filter((token) => !PLACE_NAME_MODIFIER_TOKENS.has(token));
  const distinctive = coreNameTokens.filter((token) => !AMBIGUOUS_PLACE_TOKENS.has(token));
  const required = distinctive.length ? distinctive : coreNameTokens;
  const matchedDistinctive = required.filter((token) =>
    evidenceContainsToken(evidenceTokens, token),
  );
  if (matchedDistinctive.length === 0) return 0;

  const country = expectedCountry(subject.address);
  const photoCountries = countriesMentioned(evidence);
  if (country && photoCountries.size > 0 && !photoCountries.has(country.code)) return 0;

  const localityTokens = normalizedTokens(addressLocality(subject.address)).filter(
    (token) => token.length > 2 && !PLACE_NAME_STOP_WORDS.has(token),
  );
  const countryTokens = new Set(country?.tokens ?? []);
  const specificLocalityTokens = localityTokens.filter((token) => !countryTokens.has(token));
  const localityHits = specificLocalityTokens.filter((token) =>
    evidenceContainsToken(evidenceTokens, token),
  ).length;
  const countryMatches = country ? photoCountries.has(country.code) : false;
  const ambiguous =
    distinctive.length === 0 || (distinctive.length === 1 && (distinctive[0]?.length ?? 0) < 4);

  if (ambiguous && specificLocalityTokens.length > 0 && localityHits === 0) return 0;
  if (ambiguous && specificLocalityTokens.length === 0 && country && !countryMatches) return 0;

  const allDistinctiveMatched = matchedDistinctive.length === required.length;
  const recognizableAnchor = matchedDistinctive.some((token) => token.length >= 6);
  if (!allDistinctiveMatched && !(recognizableAnchor && (localityHits > 0 || countryMatches))) {
    return 0;
  }

  const namePhrase = coreNameTokens.join(' ');
  const evidencePhrase = evidence.join(' ');

  return (
    (evidencePhrase.includes(namePhrase) ? 140 : allDistinctiveMatched ? 100 : 60) +
    matchedDistinctive.length * 4 +
    localityHits * 3 +
    (countryMatches ? 12 : 0)
  );
}
