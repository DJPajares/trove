import assert from 'node:assert/strict';
import { test } from 'vitest';

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
    assert.equal(normalizePlaceLanguageCode(value), DEFAULT_PLACE_LANGUAGE_CODE);
  }
});

test('one language is one key however it is spelled', () => {
  const keys = new Set(
    [undefined, 'en', 'EN', ' en ', 'En'].map((value) => normalizePlaceLanguageCode(value)),
  );

  assert.equal(keys.size, 1, 'Plan Score omitting the language must not fork the cache');
  assert.equal([...keys][0], 'en');
});

test('a region-qualified tag keeps its region, canonically cased', () => {
  assert.equal(normalizePlaceLanguageCode('en-us'), 'en-US');
  assert.equal(normalizePlaceLanguageCode('EN-US'), 'en-US');
});

test('a genuinely different language is a genuinely different key', () => {
  assert.notEqual(normalizePlaceLanguageCode('ja'), normalizePlaceLanguageCode('en'));
  assert.notEqual(normalizePlaceLanguageCode('en-US'), normalizePlaceLanguageCode('en'));
});

test('a malformed tag falls back rather than becoming a junk key', () => {
  assert.equal(normalizePlaceLanguageCode('not a language'), DEFAULT_PLACE_LANGUAGE_CODE);
});
