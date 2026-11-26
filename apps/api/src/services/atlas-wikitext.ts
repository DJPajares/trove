import {
  ATLAS_LISTING_KINDS,
  type AtlasBlock,
  type AtlasDestinationKind,
  type AtlasLinkedDestination,
  type AtlasListing,
  type AtlasListingKind,
  type AtlasSection,
} from '@trove/types';

/**
 * Turns a Wikivoyage article's wikitext into Atlas's reading layout (PRD 40.1).
 *
 * The output is plain text only. Source markup, links, images, tables and
 * templates never reach a client: listings become structured records, a few
 * inline templates keep their visible words, and everything else is dropped.
 * Treating the article as content and never as markup is what lets the guide
 * render with no HTML from a third party in it.
 */

const LISTING_TEMPLATES = new Set<string>(ATLAS_LISTING_KINDS);
const TEXT_TEMPLATES = new Map<string, (params: TemplateParams) => string>([
  ['lang', (p) => p.positional[1] ?? ''],
  ['w', (p) => p.positional[1] ?? p.positional[0] ?? ''],
  ['nowrap', (p) => p.positional[0] ?? ''],
  ['marker', (p) => p.named.get('name') ?? ''],
  ['convert', (p) => [p.positional[0], p.positional[1]].filter(Boolean).join(' ')],
  ['ipa', () => ''],
]);
/** Sections that only point elsewhere or repeat the page's own furniture. */
const DROPPED_SECTIONS = new Set(['go next', 'see also', 'references', 'notes']);

/**
 * Option A country-level trimming: once a country guide exposes clickable
 * `Places to Explore` destination cards, drop duplicate city/destination lists
 * and generic country-scale boilerplate that belongs inside destination guides.
 */
const COUNTRY_TRIMMED_SECTIONS = new Set([
  'cities',
  'other-destinations',
  'sleep',
  'buy',
  'work',
  'learn',
  'connect',
]);

/** URL-safe slug for a linked Wikivoyage destination within a country. */
export function slugifyDestination(title: string) {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/** First internal Wikivoyage article link in a snippet, ignoring files, categories & interwikis. */
function firstWikiLink(source: string): { label: string; target: string } | null {
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf('[[', index);
    if (start < 0) return null;
    const end = closeOf(source, start, '[[', ']]');
    const [rawTarget = '', ...labels] = splitParams(source.slice(start + 2, end - 2));
    const trimmedTarget = rawTarget.trim();
    const isIgnored =
      /^(file|image|media|category)\s*:/i.test(trimmedTarget) ||
      /^[a-z-]{1,3}\s*:/i.test(trimmedTarget);
    if (!isIgnored && trimmedTarget) {
      const target = trimmedTarget.split('#')[0]!.trim();
      const label = plainText(labels.length ? labels[labels.length - 1]! : target);
      if (target && label) return { label, target };
    }
    index = end;
  }
  return null;
}

/** Strips a leading "Name — " / "Name: " prefix from a bullet line to isolate its teaser. */
function summaryAfterName(text: string, name: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let rest = trimmed;
  if (rest.toLowerCase().startsWith(name.toLowerCase())) {
    rest = rest.slice(name.length).trim();
  }
  rest = rest.replace(/^[—–:\-,;.]+\s*/, '').trim();
  return rest || null;
}

type TemplateParams = { name: string; positional: string[]; named: Map<string, string> };

/** Index just past the bracket pair that opens at `start`, honouring nesting. */
function closeOf(text: string, start: number, open: string, close: string) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text.startsWith(open, index)) {
      depth += 1;
      index += open.length - 1;
    } else if (text.startsWith(close, index)) {
      depth -= 1;
      index += close.length - 1;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}

/** Splits on top-level pipes only: a pipe inside a link or template stays. */
function splitParams(body: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let index = 0; index < body.length; index += 1) {
    const pair = body.slice(index, index + 2);
    if (pair === '{{' || pair === '[[') {
      depth += 1;
      current += pair;
      index += 1;
    } else if ((pair === '}}' || pair === ']]') && depth > 0) {
      depth -= 1;
      current += pair;
      index += 1;
    } else if (body[index] === '|' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += body[index];
    }
  }
  parts.push(current);
  return parts;
}

function parseTemplate(source: string): TemplateParams {
  const [head = '', ...rest] = splitParams(source.slice(2, -2));
  const positional: string[] = [];
  const named = new Map<string, string>();
  for (const part of rest) {
    const equals = part.indexOf('=');
    const key = equals > 0 ? part.slice(0, equals).trim().toLowerCase() : '';
    if (key && /^[a-z0-9_ -]+$/.test(key)) named.set(key, part.slice(equals + 1).trim());
    else positional.push(part.trim());
  }
  return { name: head.trim().toLowerCase().replaceAll('_', ' '), named, positional };
}

function decodeEntities(text: string) {
  return text
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&ndash;', '–')
    .replaceAll('&mdash;', '—')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** Inline wikitext to plain words: links keep their label, everything else its text. */
export function plainText(source: string): string {
  let text = '';
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('{{', index)) {
      const end = closeOf(source, index, '{{', '}}');
      const template = parseTemplate(source.slice(index, end));
      const keep = TEXT_TEMPLATES.get(template.name);
      text += keep ? plainText(keep(template)) : '';
      index = end;
    } else if (source.startsWith('[[', index)) {
      const end = closeOf(source, index, '[[', ']]');
      const [target = '', ...labels] = splitParams(source.slice(index + 2, end - 2));
      const isMedia = /^\s*(file|image|media|category)\s*:/i.test(target);
      if (!isMedia && !/^\s*[a-z-]{2,3}\s*:/i.test(target)) {
        text += plainText(labels.length ? labels[labels.length - 1]! : target.split('#')[0]!);
      }
      index = end;
    } else if (source[index] === '[' && /^\[https?:\/\//.test(source.slice(index, index + 9))) {
      const end = source.indexOf(']', index);
      const inner = source.slice(index + 1, end < 0 ? source.length : end);
      const space = inner.indexOf(' ');
      text += space > 0 ? plainText(inner.slice(space + 1)) : '';
      index = end < 0 ? source.length : end + 1;
    } else {
      text += source[index];
      index += 1;
    }
  }
  return decodeEntities(
    text
      .replace(/'{2,}/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[ \t]+/g, ' '),
  ).trim();
}

function listingFrom(template: TemplateParams): AtlasListing | null {
  const declared = template.named.get('type')?.toLowerCase();
  const kind = (
    template.name === 'listing' && declared && LISTING_TEMPLATES.has(declared)
      ? declared
      : template.name
  ) as AtlasListingKind;
  const name = plainText(template.named.get('name') ?? '');
  if (!name) return null;
  const text = (key: string) => {
    const value = plainText(template.named.get(key) ?? '');
    return value || null;
  };
  const coordinate = (key: string, limit: number) => {
    const value = Number(template.named.get(key));
    return Number.isFinite(value) && Math.abs(value) <= limit && template.named.get(key) !== ''
      ? value
      : null;
  };
  const latitude = coordinate('lat', 90);
  const longitude = coordinate('long', 180);
  return {
    address: text('address'),
    alt: text('alt'),
    content: text('content') ?? text('description'),
    kind,
    latitude: latitude !== null && longitude !== null ? latitude : null,
    longitude: latitude !== null && longitude !== null ? longitude : null,
    name,
  };
}

/** Regionlist templates become a plain list of "Region — description" lines plus linked regions. */
function regionItems(template: TemplateParams): {
  destinations: AtlasLinkedDestination[];
  items: string[];
} {
  const items: string[] = [];
  const destinations: AtlasLinkedDestination[] = [];
  for (let n = 1; n <= 30; n += 1) {
    const rawName = template.named.get(`region${n}name`) ?? '';
    const name = plainText(rawName);
    if (!name) continue;
    const description = plainText(template.named.get(`region${n}description`) ?? '');
    items.push(description ? `${name} — ${description}` : name);
    const link = firstWikiLink(rawName);
    const target = link?.target ?? name;
    const slug = slugifyDestination(target);
    if (slug) {
      destinations.push({
        kind: 'region',
        name: link?.label ?? name,
        slug,
        summary: description || null,
        wikivoyageTitle: target,
      });
    }
  }
  return { destinations, items };
}

const LISTING_TOKEN = '\u0000listing:';
const REGIONS_TOKEN = '\u0000regions:';

type ExtractedListing = {
  listing: AtlasListing;
  rawName: string;
};

/**
 * Replaces block-level templates with tokens the line pass understands, drops
 * every other block template and every table, and leaves inline templates for
 * `plainText`.
 */
function extractBlocks(source: string) {
  const listings: ExtractedListing[] = [];
  const regionLists: { destinations: AtlasLinkedDestination[]; items: string[] }[] = [];
  let out = '';
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('{{', index)) {
      const end = closeOf(source, index, '{{', '}}');
      const raw = source.slice(index, end);
      const template = parseTemplate(raw);
      if (LISTING_TEMPLATES.has(template.name) || template.name === 'city') {
        const listing = listingFrom(
          template.name === 'city' ? { ...template, name: 'listing' } : template,
        );
        if (listing) {
          out += `${LISTING_TOKEN}${listings.length}\u0000`;
          listings.push({ listing, rawName: template.named.get('name') ?? '' });
        }
      } else if (template.name === 'regionlist') {
        out += `\n${REGIONS_TOKEN}${regionLists.length}\u0000\n`;
        regionLists.push(regionItems(template));
      } else if (TEXT_TEMPLATES.has(template.name)) {
        out += raw;
      }
      index = end;
    } else if (source.startsWith('{|', index)) {
      index = closeOf(source, index, '{|', '|}');
    } else if (/^\[\[\s*(file|image|media)\s*:/i.test(source.slice(index, index + 12))) {
      // Image captions can run over several lines; drop the whole link first.
      index = closeOf(source, index, '[[', ']]');
    } else {
      out += source[index];
      index += 1;
    }
  }
  return { listings, regionLists, text: out };
}

function sectionId(title: string, taken: Set<string>) {
  const base =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'section';
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

export type ParsedArticle = {
  destinations: AtlasLinkedDestination[];
  lead: string[];
  sections: AtlasSection[];
};

export type ParseWikivoyageOptions = {
  /**
   * `'country'` trims duplicate city/destination lists and generic country-scale
   * boilerplate when linked sub-destinations are extracted (Option A).
   */
  mode?: 'country' | 'destination';
};

export function parseWikivoyageArticle(
  wikitext: string,
  options: ParseWikivoyageOptions = {},
): ParsedArticle {
  const cleaned = wikitext
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<gallery[^>]*>[\s\S]*?<\/gallery>/gi, '');
  const { listings, regionLists, text } = extractBlocks(cleaned);

  const lead: string[] = [];
  const sections: AtlasSection[] = [];
  const destinations: AtlasLinkedDestination[] = [];
  const seenDestinationSlugs = new Set<string>();
  const addDestination = (entry: AtlasLinkedDestination) => {
    if (!entry.slug || seenDestinationSlugs.has(entry.slug)) return;
    seenDestinationSlugs.add(entry.slug);
    destinations.push(entry);
  };
  const ids = new Set<string>();
  let current: AtlasSection | null = null;
  let skipping = false;
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const currentDestinationKind = (): AtlasDestinationKind | null => {
    if (!current) return null;
    if (current.id === 'cities') return 'city';
    if (current.id === 'other-destinations') return 'destination';
    if (current.id === 'regions') return 'region';
    return null;
  };

  const blocks = () => current?.blocks ?? null;
  const flushParagraph = () => {
    const words = plainText(paragraph.join(' '));
    paragraph = [];
    if (!words || skipping) return;
    const target = blocks();
    if (target) target.push({ type: 'paragraph', text: words });
    else lead.push(words);
  };
  const flushList = () => {
    if (list?.length && !skipping) blocks()?.push({ type: 'list', items: list });
    list = null;
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };
  const push = (block: AtlasBlock) => {
    if (!skipping) blocks()?.push(block);
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const heading = /^(={2,6})\s*(.+?)\s*\1$/.exec(line);
    if (heading) {
      flush();
      const title = plainText(heading[2]!);
      if (heading[1]!.length === 2) {
        skipping = DROPPED_SECTIONS.has(title.toLowerCase());
        current = { blocks: [], id: sectionId(title, ids), title };
        if (!skipping) sections.push(current);
      } else if (title) {
        push({ type: 'heading', text: title });
      }
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    const regions = new RegExp(`^${REGIONS_TOKEN}(\\d+)\u0000$`).exec(line);
    if (regions) {
      flush();
      const entry = regionLists[Number(regions[1])];
      if (entry?.items.length) push({ type: 'list', items: entry.items });
      for (const dest of entry?.destinations ?? []) addDestination(dest);
      continue;
    }
    const bullet = /^[*#:;]+\s*(.*)$/.exec(line);
    const body = bullet ? bullet[1]! : line;
    const listing = new RegExp(`^${LISTING_TOKEN}(\\d+)\u0000(.*)$`).exec(body);
    if (listing) {
      flush();
      const extracted = listings[Number(listing[1])];
      if (extracted) {
        const tail = plainText(listing[2] ?? '');
        const resolved =
          tail && !extracted.listing.content
            ? { ...extracted.listing, content: tail }
            : extracted.listing;
        push({ type: 'listing', listing: resolved });
        const kind = currentDestinationKind();
        if (kind) {
          const link = firstWikiLink(extracted.rawName);
          const wikivoyageTitle = link?.target ?? resolved.name;
          addDestination({
            kind,
            name: link?.label ?? resolved.name,
            slug: slugifyDestination(wikivoyageTitle),
            summary: resolved.content,
            wikivoyageTitle,
          });
        }
      }
      continue;
    }
    const inline = body.replace(
      new RegExp(`${LISTING_TOKEN}(\\d+)\u0000`, 'g'),
      (_, n: string) => listings[Number(n)]?.listing.name ?? '',
    );
    if (bullet && /^[*#]/.test(line)) {
      flushParagraph();
      const item = plainText(inline);
      if (item) {
        (list ??= []).push(item);
        const kind = currentDestinationKind();
        if (kind) {
          const link = firstWikiLink(inline);
          if (link) {
            addDestination({
              kind,
              name: link.label,
              slug: slugifyDestination(link.target),
              summary: summaryAfterName(item, link.label),
              wikivoyageTitle: link.target,
            });
          }
        }
      }
    } else {
      flushList();
      paragraph.push(inline);
    }
  }
  flush();

  const hasSubDestinations = destinations.some(
    (entry) => entry.kind === 'city' || entry.kind === 'destination',
  );
  const filteredSections = sections.filter((section) => {
    if (section.blocks.length === 0) return false;
    if (
      options.mode === 'country' &&
      hasSubDestinations &&
      COUNTRY_TRIMMED_SECTIONS.has(section.id)
    ) {
      return false;
    }
    return true;
  });

  return { destinations, lead, sections: filteredSections };
}
