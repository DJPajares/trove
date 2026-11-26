import { describe, expect, it } from 'vitest';

import {
  normalizeDrivingSide,
  normalizePlugLabel,
  parseWikidataQuickFacts,
} from '../src/services/atlas-wikidata.js';

describe('atlas-wikidata', () => {
  it('normalizes verbose plug standards to concise IEC letters', () => {
    expect(normalizePlugLabel('NEMA 1-15')).toBe('A');
    expect(normalizePlugLabel('NEMA 5-15')).toBe('B');
    expect(normalizePlugLabel('Europlug')).toBe('C');
    expect(normalizePlugLabel('BS 1363')).toBe('G');
    expect(normalizePlugLabel('Type I')).toBe('I');
    expect(normalizePlugLabel('Q12345')).toBeNull();
  });

  it('normalizes driving side labels', () => {
    expect(normalizeDrivingSide('left-hand traffic')).toBe('left');
    expect(normalizeDrivingSide('right')).toBe('right');
    expect(normalizeDrivingSide('unknown')).toBeNull();
  });

  it('aggregates and deduplicates country quick facts from SPARQL bindings', () => {
    const parsed = parseWikidataQuickFacts([
      {
        code: { value: 'PH' },
        dishLabel: { value: 'Adobo' },
        driveLabel: { value: 'right' },
        langLabel: { value: 'Filipino' },
        plugLabel: { value: 'NEMA 1-15' },
      },
      {
        code: { value: 'PH' },
        langLabel: { value: 'English' },
        plugLabel: { value: 'NEMA 5-15' },
      },
      {
        code: { value: 'PH' },
        langLabel: { value: 'English' },
        plugLabel: { value: 'Europlug' },
      },
      {
        code: { value: 'JP' },
        driveLabel: { value: 'left' },
        langLabel: { value: 'Japanese' },
        plugLabel: { value: 'NEMA 1-15' },
      },
    ]);

    expect(parsed.PH).toEqual({
      drivingSide: 'right',
      languages: ['English', 'Filipino'],
      nationalDish: 'Adobo',
      plugTypes: ['A', 'B', 'C'],
    });
    expect(parsed.JP).toEqual({
      drivingSide: 'left',
      languages: ['Japanese'],
      nationalDish: null,
      plugTypes: ['A'],
    });
  });
});
