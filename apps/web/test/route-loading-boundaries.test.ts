import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const appDir = fileURLToPath(new URL('../app', import.meta.url));

function loadingBoundaries(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return loadingBoundaries(path);
    return entry.name === 'loading.tsx' ? [path] : [];
  });
}

/**
 * Next renders a loading boundary with no props. A boundary that re-exports
 * its page therefore runs that page without `params` or `searchParams`, and a
 * page that reads either throws on every navigation into it - which is how a
 * Saved collection stopped opening.
 */
test('a loading boundary only stands in for a page that reads no route props', () => {
  const offenders = loadingBoundaries(appDir).filter((loading) => {
    if (!/export\s*\{\s*default\s*\}\s*from\s*['"]\.\/page['"]/.test(readFileSync(loading, 'utf8')))
      return false;
    const page = readFileSync(join(loading, '..', 'page.tsx'), 'utf8');
    return /\b(params|searchParams)\b/.test(page);
  });
  expect(offenders.map((path) => path.slice(appDir.length))).toEqual([]);
});
