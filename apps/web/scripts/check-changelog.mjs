import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { readChangelogCatalog, readChangelogAtRef } from '../lib/updates/catalog.ts';
import {
  checkChangelogDeclaration,
  pullRequestDeclaration,
} from '../lib/updates/pr-declaration.ts';
import { createReleaseManifest } from '../lib/updates/release.ts';

const release = createReleaseManifest(
  readChangelogCatalog(fileURLToPath(new URL('../changelog.json', import.meta.url))),
  'validation',
  createRequire(import.meta.url)('../package.json').version,
);
if (process.argv.includes('--pr')) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const base = readChangelogAtRef(
    fileURLToPath(new URL('../../../', import.meta.url)),
    event.pull_request.base.sha,
  );
  const previousIds = base.map((entry) => entry.id);
  checkChangelogDeclaration(
    pullRequestDeclaration(event.pull_request, previousIds, release.entryIds),
    previousIds,
    release.entryIds,
  );
}
console.log(`Changelog valid (${release.entryIds.length} entries)`);
