import { expect, test } from 'vitest';

import {
  DEFAULT_PLACE_LANGUAGE_CODE,
  normalizePlaceLanguageCode,
} from '../src/services/place-language.js';

/**
 * A snapshot's language is part of its cache key, so two spellings of the same
 * language are two caches — and two bills for the same place.
 */

test('the ways of not naming a language all mean the default', () => {
  for (const value of [undefined, null, '', '   ']) {
    expect(normalizePlaceLanguageCode(value)).toBe(DEFAULT_PLACE_LANGUAGE_CODE);
  }
});

test('one language is one key however it is spelled', () => {
  const keys = new Set(
    [undefined, 'en', 'EN', ' en ', 'En'].map((value) => normalizePlaceLanguageCode(value)),
  );

  expect(keys.size, 'Plan Score omitting the language must not fork the cache').toBe(1);
  expect([...keys][0]).toBe('en');
});

test('a region-qualified tag keeps its region, canonically cased', () => {
  expect(normalizePlaceLanguageCode('en-us')).toBe('en-US');
  expect(normalizePlaceLanguageCode('EN-US')).toBe('en-US');
});

test('a genuinely different language is a genuinely different key', () => {
  expect(normalizePlaceLanguageCode('ja')).not.toBe(normalizePlaceLanguageCode('en'));
  expect(normalizePlaceLanguageCode('en-US')).not.toBe(normalizePlaceLanguageCode('en'));
});

test('a malformed tag falls back rather than becoming a junk key', () => {
  expect(normalizePlaceLanguageCode('not a language')).toBe(DEFAULT_PLACE_LANGUAGE_CODE);
});
