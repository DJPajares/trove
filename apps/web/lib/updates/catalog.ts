import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { isEntryId, parseChangelogEntry, type ChangelogEntry } from './release.ts';
import { isSemver } from './version.ts';

/** What a PR check needs from its base: identity, and the version a note shipped in. */
export interface BaseChangelogEntry {
  id: string;
  /** Absent for notes written before versioning. */
  version?: string;
}

export function readChangelogCatalog(directory: string): ChangelogEntry[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((year) => {
    if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) return [];
    return readdirSync(join(directory, year.name))
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const entry = parseChangelogEntry(
          JSON.parse(readFileSync(join(directory, year.name, name), 'utf8')),
        );
        if (!entry.date.startsWith(`${year.name}-`) || name !== `${entry.id}.json`) {
          throw new Error(`Changelog filename/year must match entry: ${year.name}/${name}`);
        }
        return entry;
      });
  });
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
    ['ls-tree', '-r', '--name-only', ref, '--', 'apps/web/changelog'],
    {
      cwd: repository,
      encoding: 'utf8',
    },
  );
  return files
    .split('\n')
    .filter((file) => /^apps\/web\/changelog\/\d{4}\/[^/]+\.json$/.test(file))
    .map((file) => {
      const entry: unknown = JSON.parse(
        execFileSync('git', ['show', `${ref}:${file}`], { cwd: repository, encoding: 'utf8' }),
      );
      const { id, version } = (entry ?? {}) as Record<string, unknown>;
      if (!isEntryId(id)) throw new Error(`Invalid base changelog ID: ${file}`);
      return isSemver(version) ? { id, version } : { id };
    });
}
