import { describe, expect, it } from 'vitest';

import { coverFindsCities, findsCityAnchor, groupFindsByCity } from '@/lib/saved/finds-cities';

const find = (id: string, address: string | null, createdAt: string) => ({
  id,
  createdAt,
  place: { providerAddress: address, snapshot: null },
});

describe('groupFindsByCity', () => {
  it('groups finds by the town their address names, largest group first', () => {
    const { cities, elsewhere } = groupFindsByCity([
      find('a', 'Rua Augusta 24, 1100-053 Lisboa, Portugal', '2026-05-01'),
      find('b', '68 Fukakusa Yabunouchicho, Fushimi Ward, Kyoto, 612-0882, Japan', '2026-03-01'),
      find('c', 'Praça do Comércio, 1100-148 Lisboa, Portugal', '2026-04-01'),
      find('d', null, '2026-01-01'),
    ]);
    expect(cities.map((city) => [city.name, city.places.map((place) => place.id)])).toEqual([
      ['Lisboa', ['a', 'c']],
      ['Kyoto', ['b']],
    ]);
    expect(cities[0]?.since).toBe('2026-04-01');
    expect(elsewhere.map((place) => place.id)).toEqual(['d']);
  });

  it('treats one town spelled with and without accents as one', () => {
    const { cities } = groupFindsByCity([
      find('a', '1 Bach Dang, Hai Chau, Đà Nẵng, Vietnam', '2026-05-01'),
      find('b', '2 Tran Phu, Hai Chau, Da Nang, Vietnam', '2026-04-01'),
    ]);
    expect(cities).toHaveLength(1);
    expect(cities[0]?.places).toHaveLength(2);
  });
});

describe('coverFindsCities', () => {
  it('leads with the towns kept longest', () => {
    const { cities } = groupFindsByCity([
      find('a', 'Rua Augusta 24, 1100-053 Lisboa, Portugal', '2026-05-01'),
      find('b', '68 Fukakusa Yabunouchicho, Fushimi Ward, Kyoto, 612-0882, Japan', '2026-03-01'),
    ]);
    expect(coverFindsCities(cities).map((city) => city.name)).toEqual(['Kyoto', 'Lisboa']);
  });
});

describe('findsCityAnchor', () => {
  it('makes a plain anchor from any spelling', () => {
    expect(findsCityAnchor('Đà Nẵng')).toBe('finds-da-nang');
  });
});
