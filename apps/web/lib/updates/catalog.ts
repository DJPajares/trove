import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { isEntryId, parseChangelogEntry, type ChangelogEntry } from './release.ts';
import { isSemver } from './version.ts';

/** What a PR check needs from its base: identity, and the version a note shipped in. */
export interface BaseChangelogEntry {
  id: string;
  /** Absent for notes written before versioning. */
  version?: string;
}

function parseCatalog(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Changelog must be a JSON array');
  return value;
}

export function readChangelogCatalog(file: string): ChangelogEntry[] {
  return parseCatalog(JSON.parse(readFileSync(file, 'utf8'))).map(parseChangelogEntry);
}

/**
 * Read IDs from the PR base so edits and renamed files cannot masquerade as new
 * notes. Only identity is read: the base may predate today's entry rules.
 */
export function readChangelogAtRef(repository: string, ref: string): BaseChangelogEntry[] {
  if (!/^[a-f0-9]{40}$/.test(ref))
    throw new Error('Expected a commit SHA for changelog comparison');
  const files = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', ref, '--', 'apps/web/changelog.json', 'apps/web/changelog'],
    {
      cwd: repository,
      encoding: 'utf8',
    },
  );
  const paths = files.split('\n');
  const read = (file: string): unknown =>
    JSON.parse(
      execFileSync('git', ['show', `${ref}:${file}`], { cwd: repository, encoding: 'utf8' }),
    );
  // Older PR bases still store one file per note. New bases use only the catalog.
  const entries = paths.includes('apps/web/changelog.json')
    ? parseCatalog(read('apps/web/changelog.json'))
    : paths.filter((file) => /^apps\/web\/changelog\/\d{4}\/[^/]+\.json$/.test(file)).map(read);
  return entries.map((entry) => {
    const { id, version } = (entry ?? {}) as Record<string, unknown>;
    if (!isEntryId(id)) throw new Error('Invalid base changelog ID');
    return isSemver(version) ? { id, version } : { id };
  });
}
