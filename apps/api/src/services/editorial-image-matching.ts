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

function photoDescription(altText: string | null | undefined, photoUrl: string | null | undefined) {
  let path = '';

  if (photoUrl) {
    try {
      path = decodeURIComponent(new URL(photoUrl).pathname).replace(/-\d+\/?$/, '');
    } catch {
      path = '';
    }
  }

  return normalizedTokens([altText, path].filter(Boolean).join(' '));
}

/**
 * Stock-photo metadata cannot prove physical location. Requiring the venue's
 * distinguishing words is the strongest honest evidence the provider exposes.
 */
export function editorialMatchScore(
  subject: EditorialImageSubject,
  photo: { altText?: string | null; providerPageUrl?: string | null },
) {
  if (subject.kind === 'generic') return 1;

  const nameTokens = normalizedTokens(subject.name).filter(
    (token) => !PLACE_NAME_STOP_WORDS.has(token),
  );
  if (!nameTokens.length) return 0;

  const evidence = photoDescription(photo.altText, photo.providerPageUrl);
  const evidenceTokens = new Set(evidence);
  const distinctive = nameTokens.filter((token) => !AMBIGUOUS_PLACE_TOKENS.has(token));
  const required = distinctive.length ? distinctive : nameTokens;

  if (!required.every((token) => evidenceTokens.has(token))) return 0;

  const localityTokens = normalizedTokens(addressLocality(subject.address)).filter(
    (token) => token.length > 2 && !PLACE_NAME_STOP_WORDS.has(token),
  );
  const localityHits = localityTokens.filter((token) => evidenceTokens.has(token)).length;
  const ambiguous =
    distinctive.length === 0 || (distinctive.length === 1 && (distinctive[0]?.length ?? 0) < 4);

  if (ambiguous && localityTokens.length > 0 && localityHits === 0) return 0;

  const namePhrase = nameTokens.join(' ');
  const evidencePhrase = evidence.join(' ');

  return (evidencePhrase.includes(namePhrase) ? 100 : 50) + localityHits;
}
