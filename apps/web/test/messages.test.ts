import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'messages');
const messageFiles = readdirSync(messagesDir).filter((name) => name.endsWith('.json'));

/**
 * Reports every key defined twice in the same object, as `key (line N)`.
 *
 * `JSON.parse` keeps the last of a repeated key and drops the rest in silence,
 * so a duplicate is invisible to the type system, the linter and the running
 * app. The dead copy still reads as a live string someone can edit for no
 * effect — which is how `trips.lifecycle` came to hold two different words for
 * the same status, only one of which ever rendered.
 *
 * Line numbers rather than dotted paths: it is the line you need in order to
 * delete the right copy, and reconstructing a path while scanning is the part
 * that is easy to get subtly wrong.
 */
export function duplicateKeys(source: string): string[] {
  const duplicates: string[] = [];
  const scopes: Array<Set<string>> = [];
  let line = 1;
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === '\n') {
      line += 1;
      index += 1;
      continue;
    }

    if (char === '"') {
      let end = index + 1;
      while (end < source.length && (source[end] !== '"' || source[end - 1] === '\\')) {
        if (source[end] === '\n') line += 1;
        end += 1;
      }

      let after = end + 1;
      while (after < source.length && /\s/.test(source[after]!)) after += 1;

      // Only a string followed by a colon is a key; anything else is a value.
      if (source[after] === ':') {
        const key = source.slice(index + 1, end);
        const scope = scopes.at(-1);
        if (scope) {
          if (scope.has(key)) duplicates.push(`${key} (line ${line})`);
          scope.add(key);
        }
      }

      index = end + 1;
      continue;
    }

    if (char === '{') scopes.push(new Set());
    if (char === '}') scopes.pop();
    index += 1;
  }

  return duplicates;
}

test('the detector finds a repeat and ignores the same key in a sibling object', () => {
  // Guards the guard. A detector that quietly returned nothing would let every
  // real duplicate through while the suite stayed green.
  assert.deepEqual(duplicateKeys('{"a":{"x":1,"y":2,"x":3}}'), ['x (line 1)']);
  assert.deepEqual(duplicateKeys('{"a":{"x":1},"b":{"x":2}}'), []);
});

test('the detector reads nesting and string values correctly', () => {
  // A repeat inside a nested object belongs to that object, not its parent.
  assert.deepEqual(duplicateKeys('{"a":{"b":{"x":1,"x":2}},"x":3}'), ['x (line 1)']);
  // A value that merely looks like a key must not be counted as one.
  assert.deepEqual(duplicateKeys('{"a":"x\\":","b":"c"}'), []);
  assert.deepEqual(duplicateKeys('{\n  "a": 1,\n  "b": 2,\n  "a": 3\n}'), ['a (line 4)']);
});

for (const name of messageFiles) {
  test(`${name} defines every key once`, () => {
    assert.deepEqual(
      duplicateKeys(readFileSync(join(messagesDir, name), 'utf8')),
      [],
      'a repeated key silently discards every copy but the last',
    );
  });
}
