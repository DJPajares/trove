import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * The primitives themselves, and the one drawer whose heading is part of a
 * different layout: place details sets its name on the photo cover.
 */
const ALLOWED = new Set(['components/ui/sheet.tsx', 'components/place-details-sheet.tsx']);

test('every drawer heads itself with the shared SheetHeading', () => {
  const offenders = ['components', 'app'].flatMap((folder) =>
    readdirSync(join(root, folder), { recursive: true })
      .map((entry) => join(folder, String(entry)))
      .filter((file) => file.endsWith('.tsx') && !ALLOWED.has(file))
      .filter((file) =>
        /<Sheet(?:Header|Title|Description)\b/.test(readFileSync(join(root, file), 'utf8')),
      ),
  );

  expect(offenders).toEqual([]);
});
