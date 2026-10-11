import type { PlaceLocationBias, ProviderPlaceSearchResult } from './places.js';
import { haversineKm } from './plan-score-route-comparison.js';

const words = new Intl.Segmenter('en', { granularity: 'word' });
const collator = new Intl.Collator('en', { usage: 'search', sensitivity: 'base' });

export function normalizeIdentityText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function identityTokens(value: string) {
  return [...words.segment(normalizeIdentityText(value))]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);
}

export function sameIdentityName(left: string, right: string) {
  const compact = (text: string) => normalizeIdentityText(text).replaceAll(' ', '');
  return Boolean(compact(left)) && collator.compare(compact(left), compact(right)) === 0;
}

function oneEditApart(left: string, right: string) {
  const a = [...left],
    b = [...right];
  if (Math.min(a.length, b.length) < 8 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return (
      a.slice(i + 1).join('') === b.slice(i + 1).join('') ||
      (a[i] === b[i + 1] &&
        a[i + 1] === b[i] &&
        a.slice(i + 2).join('') === b.slice(i + 2).join(''))
    );
  }
  return a.length > b.length
    ? a.slice(i + 1).join('') === b.slice(i).join('')
    : a.slice(i).join('') === b.slice(i + 1).join('');
}

/** Ordinal evidence tiers, not fabricated probability estimates. */
export function nameMatchTier(left: string, right: string): number {
  if (sameIdentityName(left, right)) return 3;
  const a = identityTokens(left),
    b = identityTokens(right);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (
    short.length >= 2 &&
    short.every((token) => long.some((other) => sameIdentityName(token, other)))
  )
    return 2;
  return oneEditApart(normalizeIdentityText(left), normalizeIdentityText(right)) ? 1 : 0;
}

export type MatchingContext = {
  name: string;
  searchName?: string | null;
  localityHint?: string | null;
  locationBias?: PlaceLocationBias;
  countryCode?: string;
  requireExactName?: boolean;
  /** Conflicting explicit destinations cannot supply a uniqueness claim. */
  contextConflict?: boolean;
};

type LocatedIdentity = Pick<
  ProviderPlaceSearchResult,
  'name' | 'formattedAddress' | 'location' | 'rawTypes'
> &
  Pick<Partial<ProviderPlaceSearchResult>, 'addressComponents'>;

const LOCALITY_TYPES = new Set([
  'locality',
  'postal_town',
  'sublocality',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
]);
const STREET_TYPES = new Set(['route', 'street_address', 'intersection']);

export function localityMatches(
  identity: Pick<LocatedIdentity, 'formattedAddress' | 'addressComponents'>,
  hint?: string | null,
) {
  if (!hint?.trim()) return false;
  // A comma-qualified country is never the evidence placing a venue in a city.
  const locality = hint.split(',')[0]!.trim();
  const components = identity.addressComponents;
  if (components?.length) {
    const countryNames = components
      .filter((part) => part.types.includes('country'))
      .flatMap((part) => [part.longText, part.shortText]);
    if (countryNames.some((name) => sameIdentityName(name, locality))) return false;
    return components
      .filter((part) =>
        part.types.some(
          (type) => LOCALITY_TYPES.has(type) || type.startsWith('sublocality_level_'),
        ),
      )
      .some((part) =>
        [part.longText, part.shortText].some(
          (name) => sameIdentityName(name, locality) || nameMatchTier(name, locality) >= 2,
        ),
      );
  }
  // Older snapshots lack components. Only inspect address sections before the
  // final country; a one-section address can still identify a city-state.
  const sections = identity.formattedAddress?.split(',').map((part) => part.trim()) ?? [];
  // A bare country name is not locality evidence. Without structured components,
  // a single section needs address/postal detail before it can support a match.
  if (sections.length === 1 && !/\p{Number}/u.test(sections[0]!)) return false;
  const localSections =
    sections.length > 1 && !/\p{Number}/u.test(sections.at(-1)!) ? sections.slice(0, -1) : sections;
  const compact = normalizeIdentityText(locality).replaceAll(' ', '');
  return localSections.some((section) => {
    const address = normalizeIdentityText(section).replaceAll(' ', '');
    if (compact.length >= 4 && address.includes(compact)) return true;
    const a = identityTokens(locality),
      b = identityTokens(section);
    // Whole tokens, with a majority of the locality; short fragments do not
    // establish geography (e.g. 'ha' appearing in an unrelated street).
    const matching = a.filter((token) => b.some((other) => sameIdentityName(token, other)));
    return (
      matching.length > 0 &&
      matching.length >= Math.ceil(a.length / 2) &&
      matching.join('').length >= 4
    );
  });
}

export function geographicallyEligible(identity: LocatedIdentity, candidate: MatchingContext) {
  if (candidate.contextConflict) return false;
  const country = identity.addressComponents?.find((part) =>
    part.types.includes('country'),
  )?.shortText;
  if (
    country &&
    candidate.countryCode &&
    country.toUpperCase() !== candidate.countryCode.toUpperCase()
  )
    return false;
  if (candidate.requireExactName) {
    const appropriateType = identity.rawTypes.some(
      (type) =>
        LOCALITY_TYPES.has(type) || type === 'country' || type === 'administrative_area_level_4',
    );
    // The city name alone cannot override an explicit region/country qualifier.
    const qualifiers = (candidate.localityHint?.split(',') ?? [])
      .map((part) => part.trim())
      .filter(
        (part) =>
          part &&
          ![candidate.name, candidate.searchName].some(
            (name) => name && sameIdentityName(part, name),
          ),
      );
    const geography = identity.addressComponents?.length
      ? identity.addressComponents
          .filter((part) =>
            part.types.some((type) => LOCALITY_TYPES.has(type) || type === 'country'),
          )
          .flatMap((part) => [part.longText, part.shortText])
      : (identity.formattedAddress?.split(',').map((part) => part.trim()) ?? []);
    return (
      appropriateType &&
      qualifiers.every((qualifier) => geography.some((part) => nameMatchTier(part, qualifier) >= 2))
    );
  }
  const names = [candidate.name, candidate.searchName].filter((name): name is string =>
    Boolean(name),
  );
  if (
    identity.rawTypes.some((type) => STREET_TYPES.has(type)) &&
    !names.some((name) => sameIdentityName(name, identity.name))
  )
    return false;
  return (
    localityMatches(identity, candidate.localityHint) ||
    Boolean(
      candidate.locationBias &&
      haversineKm(identity.location, candidate.locationBias) <=
        candidate.locationBias.radiusMeters / 1000,
    )
  );
}

export function rankPlaceMatches<T extends LocatedIdentity & { externalPlaceId: string }>(
  identities: readonly T[],
  candidate: MatchingContext,
  aliases = new Map<string, string[]>(),
) {
  const names = [candidate.name, candidate.searchName].filter((name): name is string =>
    Boolean(name),
  );
  const ranked = [
    ...new Map(identities.map((identity) => [identity.externalPlaceId, identity])).values(),
  ]
    .filter((identity) => geographicallyEligible(identity, candidate))
    .map((identity) => ({
      identity,
      tier: Math.max(
        ...[identity.name, ...(aliases.get(identity.externalPlaceId) ?? [])].flatMap((name) =>
          names.map((expected) => nameMatchTier(name, expected)),
        ),
      ),
    }))
    .filter(({ tier }) => (candidate.requireExactName ? tier === 3 : tier > 0));
  const best = Math.max(0, ...ranked.map(({ tier }) => tier));
  // Ranking never breaks a tie between equally supported real-world identities.
  return ranked.filter(({ tier }) => tier === best).map(({ identity }) => identity);
}
