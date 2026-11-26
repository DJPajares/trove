import { describe, expect, it } from 'vitest';

import { parseWikivoyageArticle, plainText } from '../src/services/atlas-wikitext.js';

const ARTICLE = `{{pagebanner|Japan banner.jpg}}
{{quickbar}}
'''Japan''' ([[w:Japanese language|Japanese]]: {{lang|ja|日本}}) is an island nation in [[East Asia]].<ref>A source</ref>

It mixes old and new.<!-- editor note -->
[[File:Fuji.jpg|thumb|Mount [[Fuji]] at dawn]]

==Regions==
{{Regionlist
| region1name=[[Hokkaido]]
| region1description=Snowy north.
| region2name=[[Kyushu]]
| region2description=
}}

==Understand==
===History===
Japan's history spans '''millennia''' &ndash; see [https://example.com the museum] for more.
* Edo period
* Meiji era

{| class="wikitable"
| Climate || table
|}

==See==
* {{see| name=Fushimi Inari | alt=伏見稲荷 | url=https://example.com | lat=34.967 | long=135.772 | content=Gates up the [[mountain|hill]]. }}
* {{listing| type=eat | name=Ramen stall | lat= | long= | content= }} Cheap and quick.
* {{see| name= | content=No name, no listing. }}

==Go next==
* [[South Korea]]
`;

describe('parseWikivoyageArticle', () => {
  const parsed = parseWikivoyageArticle(ARTICLE);

  it('keeps the lead as plain paragraphs, without banners, refs, comments or images', () => {
    expect(parsed.lead).toEqual([
      'Japan (Japanese: 日本) is an island nation in East Asia.',
      'It mixes old and new.',
    ]);
  });

  it('turns a region list into plain lines', () => {
    expect(parsed.sections[0]).toEqual({
      blocks: [{ items: ['Hokkaido — Snowy north.', 'Kyushu'], type: 'list' }],
      id: 'regions',
      title: 'Regions',
    });
  });

  it('keeps subheadings, paragraphs and lists, and drops tables and external URLs', () => {
    expect(parsed.sections[1]?.blocks).toEqual([
      { text: 'History', type: 'heading' },
      { text: "Japan's history spans millennia – see the museum for more.", type: 'paragraph' },
      { items: ['Edo period', 'Meiji era'], type: 'list' },
    ]);
  });

  it('turns listing templates into structured listings', () => {
    expect(parsed.sections[2]?.blocks).toEqual([
      {
        listing: {
          address: null,
          alt: '伏見稲荷',
          content: 'Gates up the hill.',
          kind: 'see',
          latitude: 34.967,
          longitude: 135.772,
          name: 'Fushimi Inari',
        },
        type: 'listing',
      },
      {
        listing: {
          address: null,
          alt: null,
          content: 'Cheap and quick.',
          kind: 'eat',
          latitude: null,
          longitude: null,
          name: 'Ramen stall',
        },
        type: 'listing',
      },
    ]);
  });

  it('drops sections that only point elsewhere', () => {
    expect(parsed.sections.map((section) => section.id)).toEqual(['regions', 'understand', 'see']);
  });

  it('extracts linked destinations from Regions, Cities, and Other destinations and trims country boilerplate in country mode', () => {
    const countryArticle = `An island nation.

==Regions==
{{Regionlist
| region1name=[[Visayas]]
| region1description=Central islands.
}}

==Cities==
* [[Manila]] — Capital city.
* {{city| name=[[Cebu City|Cebu]] | content=Historic port. }}

==Other destinations==
* [[Bohol]] — Chocolate Hills and tarsiers.
* [[Siargao]] — Surf island.

==Understand==
Rich maritime history.

==Sleep==
Generic country sleep boilerplate.
`;
    const country = parseWikivoyageArticle(countryArticle, { mode: 'country' });
    expect(country.destinations).toEqual([
      {
        kind: 'region',
        name: 'Visayas',
        slug: 'visayas',
        summary: 'Central islands.',
        wikivoyageTitle: 'Visayas',
      },
      {
        kind: 'city',
        name: 'Manila',
        slug: 'manila',
        summary: 'Capital city.',
        wikivoyageTitle: 'Manila',
      },
      {
        kind: 'city',
        name: 'Cebu',
        slug: 'cebu-city',
        summary: 'Historic port.',
        wikivoyageTitle: 'Cebu City',
      },
      {
        kind: 'destination',
        name: 'Bohol',
        slug: 'bohol',
        summary: 'Chocolate Hills and tarsiers.',
        wikivoyageTitle: 'Bohol',
      },
      {
        kind: 'destination',
        name: 'Siargao',
        slug: 'siargao',
        summary: 'Surf island.',
        wikivoyageTitle: 'Siargao',
      },
    ]);
    // Option A: Cities, Other destinations, and generic country-level Sleep are trimmed.
    expect(country.sections.map((s) => s.id)).toEqual(['regions', 'understand']);
  });
});

it('drops an image whose caption runs over several lines', () => {
  const parsed = parseWikivoyageArticle(
    '==Get in==\n[[File:Visa.svg|thumb|Visa policy{{legend|#ED1C24|Japan}}\n{{legend|#008000|Visa free}}]]\nMost visitors need no visa.\n',
  );
  expect(parsed.sections[0]?.blocks).toEqual([
    { text: 'Most visitors need no visa.', type: 'paragraph' },
  ]);
});

describe('plainText', () => {
  it('never lets markup through', () => {
    expect(plainText('<script>alert(1)</script>Hi <b>there</b>')).toBe('alert(1)Hi there');
  });

  it('drops interlanguage and category links but keeps ordinary link labels', () => {
    expect(plainText('[[fr:Japon]][[Category:Asia]][[Tokyo]] and [[Kyoto|the old capital]]')).toBe(
      'Tokyo and the old capital',
    );
  });
});
