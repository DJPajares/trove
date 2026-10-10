import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseChangelogEntry, type ChangelogEntry } from './release.ts';

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

/** Read IDs from the PR base so edits and renamed files cannot masquerade as new notes. */
export function readChangelogAtRef(repository: string, ref: string): ChangelogEntry[] {
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
    .map((file) =>
      parseChangelogEntry(
        JSON.parse(
          execFileSync('git', ['show', `${ref}:${file}`], { cwd: repository, encoding: 'utf8' }),
        ),
      ),
    );
}
