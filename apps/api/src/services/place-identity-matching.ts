import type { PlaceLocationBias, ProviderPlaceSearchResult } from './places.js';
import { haversineKm } from './plan-score-route-comparison.js';
import { resolveDestinationCountryCode } from './trip-rules.js';

const words = new Intl.Segmenter('en', { granularity: 'word' });
const collator = new Intl.Collator('en', { usage: 'search', sensitivity: 'base' });

export function normalizeIdentityText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/(\p{Script=Latin})\p{Mark}+/gu, '$1')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\p{Mark}]+/gu, ' ')
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
  const a = compact(left),
    b = compact(right);
  // Latin accents support transliterations. Marks in other scripts can change
  // the name itself, so an English base collator must not erase those marks.
  return (
    Boolean(a) &&
    (a === b ||
      (/^[\p{Script=Latin}\p{Number}]+$/u.test(a) &&
        /^[\p{Script=Latin}\p{Number}]+$/u.test(b) &&
        collator.compare(a, b) === 0))
  );
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

/** A contraction must retain both ends, with other complete words agreeing. */
function contractedToken(left: string, right: string) {
  const [short, long] = left.length < right.length ? [left, right] : [right, left];
  if (
    !/^\p{Script=Latin}{2,3}$/u.test(short) ||
    !/^\p{Script=Latin}+$/u.test(long) ||
    long.length < short.length + 2
  )
    return false;
  if (short[0] !== long[0] || short.at(-1) !== long.at(-1)) return false;
  let i = 0;
  for (const letter of long) if (letter === short[i]) i++;
  return i === short.length;
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
  const unmatched = short.filter((token) => !long.some((other) => sameIdentityName(token, other)));
  if (
    short.length >= 3 &&
    unmatched.length === 1 &&
    long.some((token) => contractedToken(token, unmatched[0]!))
  )
    return 2;
  const extra = long.filter((token) => !short.some((other) => sameIdentityName(token, other)));
  if (
    short.length === long.length &&
    short.length >= 3 &&
    unmatched.length === 1 &&
    extra.length === 1 &&
    Math.min(unmatched[0]!.length, extra[0]!.length) >= 4 &&
    (unmatched[0]!.startsWith(extra[0]!) || extra[0]!.startsWith(unmatched[0]!))
  )
    return 1;
  return oneEditApart(normalizeIdentityText(left), normalizeIdentityText(right)) ? 1 : 0;
}

export type MatchingContext = {
  name: string;
  searchName?: string | null;
  localityHint?: string | null;
  /** A name from the verified destination identity, never supplied by the model. */
  destinationName?: string;
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
const DESTINATION_TYPES = new Set([
  ...LOCALITY_TYPES,
  'country',
  'administrative_area_level_4',
  'island',
  'natural_feature',
  'national_park',
]);
const GENERIC_TYPES = new Set(['political', 'geocode', 'establishment', 'point_of_interest']);

function componentMatches(name: string, hint: string, types: readonly string[]) {
  if (sameIdentityName(name, hint) || nameMatchTier(name, hint) >= 2) return true;
  // Structured regions often append an administrative designation. A complete
  // prefix in that typed component is evidence; arbitrary address substrings are not.
  const expected = normalizeIdentityText(hint);
  return (
    types.some((type) => type.startsWith('administrative_area_level_')) &&
    expected.replaceAll(' ', '').length >= 4 &&
    normalizeIdentityText(name).startsWith(`${expected} `)
  );
}

function withoutProviderCountry(name: string, identity: LocatedIdentity) {
  const normalized = normalizeIdentityText(name);
  const country = identity.addressComponents?.find((part) => part.types.includes('country'));
  for (const label of [country?.longText, country?.shortText]) {
    if (!label) continue;
    const qualifier = normalizeIdentityText(label);
    if (normalized.startsWith(`${qualifier} `)) return normalized.slice(qualifier.length + 1);
    if (normalized.endsWith(` ${qualifier}`)) return normalized.slice(0, -qualifier.length - 1);
  }
  return name;
}

/** Distinguish an untranslated city from a comparable, explicitly different city. */
export function hasComparableLocalityMismatch(
  identity: LocatedIdentity,
  candidate: MatchingContext,
) {
  if (candidate.requireExactName || !candidate.localityHint) return false;
  const city = candidate.localityHint.split(',')[0]!.trim();
  const latin = (name: string) =>
    /^[\p{Script=Latin}\p{Number}\s]+$/u.test(normalizeIdentityText(name));
  if (!latin(city)) return false;
  const components = identity.addressComponents ?? [];
  const cities = components.filter((part) =>
    part.types.some((type) => type === 'locality' || type === 'postal_town'),
  );
  const names = cities.flatMap((part) => [part.longText, part.shortText]).filter(Boolean);
  const cityTokens = identityTokens(city);
  const related = names.some((name) =>
    identityTokens(name).some((token) =>
      cityTokens.some((expected) => expected.length >= 5 && sameIdentityName(token, expected)),
    ),
  );
  return names.length > 0 && names.every(latin) && !related && !localityMatches(identity, city);
}

export function localityMatches(
  identity: Pick<LocatedIdentity, 'formattedAddress' | 'addressComponents'>,
  hint?: string | null,
) {
  if (!hint?.trim()) return false;
  // A comma-qualified country is never the evidence placing a venue in a city.
  const locality = hint.split(',')[0]!.trim();
  const components = identity.addressComponents;
  if (components?.length) {
    return components
      .filter((part) =>
        part.types.some(
          (type) => LOCALITY_TYPES.has(type) || type.startsWith('sublocality_level_'),
        ),
      )
      .some((part) =>
        [part.longText, part.shortText].some((name) =>
          componentMatches(name, locality, part.types),
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

/** Hard conflicts stay separate from absent or untranslated locality evidence. */
export function identityCompatible(identity: LocatedIdentity, candidate: MatchingContext) {
  if (candidate.contextConflict) return false;
  const country = identity.addressComponents?.find((part) =>
    part.types.includes('country'),
  )?.shortText;
  const expectedCountry =
    resolveDestinationCountryCode(candidate.localityHint ?? '') ?? candidate.countryCode;
  if (country && expectedCountry && country.toUpperCase() !== expectedCountry.toUpperCase())
    return false;
  if (candidate.requireExactName) {
    return identity.rawTypes.some((type) => DESTINATION_TYPES.has(type));
  }
  const geographicIdentity =
    identity.rawTypes.includes('natural_feature') ||
    identity.rawTypes.every(
      (type) => LOCALITY_TYPES.has(type) || type === 'country' || GENERIC_TYPES.has(type),
    );
  const requestedName = withoutProviderCountry(candidate.name, identity);
  // A geographic parent is not the named facility/viewpoint within it. A broad
  // model search hint cannot erase the original stop's identity; retry its name.
  if (
    geographicIdentity &&
    identityTokens(requestedName).length > identityTokens(identity.name).length &&
    nameMatchTier(requestedName, identity.name) === 2
  )
    return false;
  return (
    !identity.rawTypes.some((type) => STREET_TYPES.has(type)) ||
    [candidate.name, candidate.searchName].some(
      (name) => name && sameIdentityName(name, identity.name),
    )
  );
}

export function geographicallyEligible(
  identity: LocatedIdentity,
  candidate: MatchingContext,
  addressAliases: readonly string[] = [],
) {
  if (!identityCompatible(identity, candidate)) return false;
  if (candidate.requireExactName) {
    // Missing regional components do not contradict an exact city and country.
    // A supplied country still has to agree; aliases are tied to this Place ID.
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
          .flatMap((part) =>
            [part.longText, part.shortText].map((name) => ({ name, types: part.types })),
          )
      : (identity.formattedAddress?.split(',').map((name) => ({ name: name.trim(), types: [] })) ??
        []);
    geography.push(
      ...addressAliases.flatMap((address) =>
        address.split(',').map((name) => ({ name: name.trim(), types: [] })),
      ),
    );
    const matches = (qualifier: string) =>
      geography.some((part) => componentMatches(part.name, qualifier, part.types));
    const hasRegion = identity.addressComponents?.some((part) =>
      part.types.some((type) => type.startsWith('administrative_area_level_')),
    );
    if (!qualifiers.length) return true;
    // The final country must agree. Earlier hints can describe several levels
    // of geography that Google omits; one corroborated level supports the city.
    return (
      matches(qualifiers.at(-1)!) &&
      (qualifiers.length === 1 || !hasRegion || qualifiers.slice(0, -1).some(matches))
    );
  }
  const hints = [candidate.localityHint, candidate.destinationName];
  const components = identity.addressComponents ?? [];
  const country = components.find((part) => part.types.includes('country'));
  const qualifiers = candidate.localityHint?.split(',').map((part) => part.trim()) ?? [];
  // Natural features often have a region and country but no city component.
  // Corroborate both levels rather than interpreting the region as a wrong city.
  const regionalSupport =
    !components.some((part) =>
      part.types.some((type) => type === 'locality' || type === 'postal_town'),
    ) &&
    Boolean(
      country &&
      (candidate.countryCode === country.shortText ||
        [country.longText, country.shortText].some((name) =>
          sameIdentityName(name, qualifiers.at(-1) ?? ''),
        )),
    ) &&
    qualifiers
      .slice(1)
      .some((hint) =>
        components.some(
          (part) =>
            part.types.some((type) => type.startsWith('administrative_area_level_')) &&
            [part.longText, part.shortText].some((name) =>
              componentMatches(name, hint, part.types),
            ),
        ),
      );
  return (
    hints.some((hint) => localityMatches(identity, hint)) ||
    regionalSupport ||
    (!hasComparableLocalityMismatch(identity, candidate) &&
      addressAliases.some((address) =>
        hints.some((hint) => localityMatches({ formattedAddress: address }, hint)),
      )) ||
    Boolean(
      candidate.locationBias &&
      (!hasComparableLocalityMismatch(identity, candidate) ||
        Boolean(
          candidate.destinationName &&
          !sameIdentityName(candidate.destinationName, candidate.localityHint?.split(',')[0] ?? ''),
        )) &&
      haversineKm(identity.location, candidate.locationBias) <=
        candidate.locationBias.radiusMeters / 1000,
    )
  );
}

export function rankPlaceMatches<T extends LocatedIdentity & { externalPlaceId: string }>(
  identities: readonly T[],
  candidate: MatchingContext,
  aliases = new Map<string, string[]>(),
  addressAliases = new Map<string, string[]>(),
) {
  const names = [candidate.name, candidate.searchName].filter((name): name is string =>
    Boolean(name),
  );
  const ranked = [
    ...new Map(identities.map((identity) => [identity.externalPlaceId, identity])).values(),
  ]
    .filter((identity) =>
      geographicallyEligible(identity, candidate, addressAliases.get(identity.externalPlaceId)),
    )
    .map((identity) => ({
      identity,
      venue:
        !identity.rawTypes.some((type) => STREET_TYPES.has(type)) &&
        identity.rawTypes.some(
          (type) => !LOCALITY_TYPES.has(type) && type !== 'country' && !GENERIC_TYPES.has(type),
        )
          ? 1
          : 0,
      requested: Math.max(
        ...[identity.name, ...(aliases.get(identity.externalPlaceId) ?? [])].map((name) =>
          nameMatchTier(name, candidate.name),
        ),
      ),
      tier: Math.max(
        ...[identity.name, ...(aliases.get(identity.externalPlaceId) ?? [])].flatMap((name) =>
          names.map((expected) =>
            nameMatchTier(
              name,
              candidate.requireExactName ? withoutProviderCountry(expected, identity) : expected,
            ),
          ),
        ),
      ),
    }))
    .filter(({ tier }) => (candidate.requireExactName ? tier >= 2 : tier > 0));
  const best = Math.max(0, ...ranked.map(({ tier }) => tier));
  const bestType = candidate.requireExactName
    ? 0
    : Math.max(0, ...ranked.filter(({ tier }) => tier === best).map(({ venue }) => venue));
  const compatible = ranked.filter(
    ({ tier, venue }) => tier === best && (candidate.requireExactName || venue === bestType),
  );
  const bestRequested = Math.max(0, ...compatible.map(({ requested }) => requested));
  // Ranking never breaks a tie between equally supported real-world identities.
  return compatible
    .filter(({ requested }) => requested === bestRequested)
    .map(({ identity }) => identity);
}
