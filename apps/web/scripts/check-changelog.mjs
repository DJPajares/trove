import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { readChangelogCatalog, readChangelogAtRef } from '../lib/updates/catalog.ts';
import { checkChangelogDeclaration } from '../lib/updates/pr-declaration.ts';
import { createReleaseManifest } from '../lib/updates/release.ts';

const release = createReleaseManifest(
  readChangelogCatalog(fileURLToPath(new URL('../changelog/', import.meta.url))),
  'validation',
  createRequire(import.meta.url)('../package.json').version,
);
if (process.argv.includes('--pr')) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const base = readChangelogAtRef(
    fileURLToPath(new URL('../../../', import.meta.url)),
    event.pull_request.base.sha,
  );
  checkChangelogDeclaration(
    event.pull_request.body ?? '',
    base.map((entry) => entry.id),
    release.entryIds,
  );
}
console.log(`Changelog valid (${release.entryIds.length} entries)`);
