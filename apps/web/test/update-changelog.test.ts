import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { readChangelogAtRef, readChangelogCatalog } from '../lib/updates/catalog.ts';
import {
  INSTALLED_CHANGELOG_KEY,
  parseInstalledHistory,
  rememberInstalledEntries,
} from '../lib/updates/history.ts';
import { checkChangelogDeclaration } from '../lib/updates/pr-declaration.ts';
import {
  createReleaseManifest,
  parseChangelogEntry,
  parseReleaseManifest,
  unseenSummaries,
  type ChangelogEntry,
} from '../lib/updates/release.ts';
import { checkVersions, type VersionCheckInput } from '../lib/updates/version-check.ts';
import { compareSemver, isSemver } from '../lib/updates/version.ts';
import { requestWorkerRelease } from '../lib/updates/worker.ts';

function note(id: string, date = '2026-10-11', version = '1.0.0'): ChangelogEntry {
  return { id, date, version, summaries: { en: [`Your trip feels clearer with ${id}.`] } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('catalog integrity', () => {
  test('validates localized summaries and real calendar dates', () => {
    expect(parseChangelogEntry(note('trip-days'))).toEqual(note('trip-days'));
    for (const invalid of [
      { ...note('trip-days'), date: '2026-02-30' },
      { ...note('trip-days'), id: 'Developer_ID' },
      { ...note('trip-days'), summaries: { fr: ['Des journées plus claires.'] } },
      { ...note('trip-days'), summaries: { en: [] } },
      { ...note('trip-days'), summaries: { en: ['x'.repeat(181)] } },
      { ...note('trip-days'), summaries: { en: ['A', 'B', 'C', 'D'] } },
      { ...note('trip-days'), summaries: { en: ['  Extra space'] } },
      { ...note('trip-days'), summaries: { en: ['Two\nlines'] } },
    ])
      expect(() => parseChangelogEntry(invalid)).toThrow();
  });

  test('keeps all historical IDs but displays only the newest 100 entries', () => {
    const entries = Array.from({ length: 103 }, (_, index) =>
      note(`trip-${index}`, index < 3 ? '2025-01-01' : '2026-10-11'),
    );
    const release = createReleaseManifest(entries, 'build-a', '1.0.0');
    expect(release.entryIds).toHaveLength(103);
    expect(release.entries).toHaveLength(100);
    expect(release.entries.every((entry) => entry.date === '2026-10-11')).toBe(true);
    expect(() => createReleaseManifest([note('same'), note('same')], 'build-a', '1.0.0')).toThrow(
      /Duplicate/,
    );
    expect(() => createReleaseManifest([], '', '1.0.0')).toThrow(/build ID/);
  });

  test('ties every note to a web version no newer than the release carrying it', () => {
    expect(() => parseChangelogEntry({ ...note('days'), version: '1.0' })).toThrow(/version/);
    expect(() => parseChangelogEntry({ ...note('days'), version: undefined })).toThrow(/version/);
    expect(() => createReleaseManifest([note('days')], 'build-a', 'v1')).toThrow(/web version/);
    expect(() =>
      createReleaseManifest([note('days', '2026-10-11', '1.2.0')], 'build-a', '1.1.9'),
    ).toThrow(/newer than web 1.1.9/);
    expect(createReleaseManifest([note('days')], 'build-a', '1.10.0').version).toBe('1.10.0');
  });

  test('orders versions numerically', () => {
    expect(compareSemver('1.10.0', '1.9.9')).toBe(1);
    expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
    expect(compareSemver('0.9.0', '1.0.0')).toBe(-1);
    expect(isSemver('1.0.0-beta')).toBe(false);
    expect(isSemver('01.0.0')).toBe(false);
  });

  test('reads one catalog across years and validates its shape and entries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'trove-changelog-'));
    try {
      const file = join(directory, 'changelog.json');
      const entries = [note('trip-days'), note('older-trip', '2025-01-01')];
      writeFileSync(file, JSON.stringify(entries));
      expect(readChangelogCatalog(file)).toEqual(entries);
      writeFileSync(file, JSON.stringify(entries[0]));
      expect(() => readChangelogCatalog(file)).toThrow(/JSON array/);
      writeFileSync(file, JSON.stringify([{ ...note('trip-days'), version: 'bad' }]));
      expect(() => readChangelogCatalog(file)).toThrow(/version/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('preserves PR history checks across the migration and later single-file additions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'trove-changelog-history-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
    const commit = () => {
      git('add', '.');
      git(
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '--no-gpg-sign',
        '-m',
        'Catalog fixture',
      );
      return git('rev-parse', 'HEAD');
    };
    try {
      git('init', '-b', 'catalog-fixture');
      const legacy = join(directory, 'apps/web/changelog/2026');
      mkdirSync(legacy, { recursive: true });
      const { version: _version, ...unversioned } = note('unversioned');
      writeFileSync(join(legacy, 'unversioned.json'), JSON.stringify(unversioned));
      writeFileSync(join(legacy, 'trip-days.json'), JSON.stringify(note('trip-days')));
      const legacyRef = commit();
      expect(readChangelogAtRef(directory, legacyRef)).toEqual([
        { id: 'trip-days', version: '1.0.0' },
        { id: 'unversioned' },
      ]);

      const file = join(directory, 'apps/web/changelog.json');
      const entries = [note('trip-days'), note('unversioned')];
      rmSync(join(directory, 'apps/web/changelog'), { recursive: true });
      writeFileSync(file, JSON.stringify(entries));
      const migratedRef = commit();
      const migrated = readChangelogAtRef(directory, migratedRef);
      expect(migrated).toEqual(entries.map(({ id, version }) => ({ id, version })));
      expect(() =>
        checkChangelogDeclaration(
          'Changelog: none — Consolidate storage',
          readChangelogAtRef(directory, legacyRef).map(({ id }) => id),
          readChangelogCatalog(file).map(({ id }) => id),
        ),
      ).not.toThrow();

      writeFileSync(file, JSON.stringify([...entries, note('new-trip')]));
      const currentIds = readChangelogCatalog(file).map(({ id }) => id);
      expect(() =>
        checkChangelogDeclaration(
          'Changelog: added',
          migrated.map(({ id }) => id),
          currentIds,
        ),
      ).not.toThrow();
      expect(() =>
        checkChangelogDeclaration(
          'Changelog: none — Internal',
          migrated.map(({ id }) => id),
          currentIds,
        ),
      ).toThrow(/require/);
      expect(() =>
        checkChangelogDeclaration(
          'Changelog: none — Internal',
          migrated.map(({ id }) => id),
          ['trip-days'],
        ),
      ).toThrow(/Preserve/);

      writeFileSync(file, '{}');
      expect(() => readChangelogAtRef(directory, commit())).toThrow(/JSON array/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects incompatible, duplicate, or unregistered worker metadata', () => {
    const valid = createReleaseManifest([note('days')], 'build-a', '1.0.0');
    expect(parseReleaseManifest(valid)).toEqual(valid);
    for (const invalid of [
      null,
      { ...valid, appId: 'another-app' },
      { ...valid, schemaVersion: 2 },
      { ...valid, entryIds: ['days', 'days'] },
      { ...valid, entries: [note('unregistered')] },
      { ...valid, entries: [note('days'), note('days')] },
      { ...valid, entries: [{ id: 'days' }] },
    ])
      expect(parseReleaseManifest(invalid)).toBeNull();
  });
});

describe('installed and unseen changes', () => {
  const old = createReleaseManifest([note('old')], 'build-a', '1.0.0');
  const target = createReleaseManifest(
    [note('old'), note('middle'), note('newest')],
    'build-c',
    '1.0.0',
  );

  test('includes skipped updates while excluding the running build and installed history', () => {
    const lineIds = (releases: ReturnType<typeof unseenSummaries>) =>
      releases.flatMap((release) => release.lines.map((line) => line.id));
    expect(lineIds(unseenSummaries(target, old, [], 'en'))).toEqual(['middle:0', 'newest:0']);
    expect(lineIds(unseenSummaries(target, old, ['middle'], 'en'))).toEqual(['newest:0']);
    expect(unseenSummaries(target, target, [], 'en')).toEqual([]);
    expect(unseenSummaries(target, null, [], 'en')).toEqual([]);
  });

  test('groups unseen notes under the release that delivered them, newest first', () => {
    const grouped = createReleaseManifest(
      [
        note('first', '2026-10-01', '1.1.0'),
        note('patch', '2026-10-03', '1.1.1'),
        note('feature', '2026-10-05', '1.10.0'),
        note('second', '2026-10-02', '1.1.0'),
      ],
      'build-d',
      '1.10.0',
    );
    expect(
      unseenSummaries(grouped, old, [], 'en').map((release) => [
        release.version,
        release.lines.map((line) => line.id),
      ]),
    ).toEqual([
      ['1.10.0', ['feature:0']],
      ['1.1.1', ['patch:0']],
      ['1.1.0', ['second:0', 'first:0']],
    ]);
  });

  test('a worker built before versioning stays a baseline without showing notes', () => {
    const { version: _version, ...legacy } = createReleaseManifest(
      [note('old')],
      'legacy-build',
      '1.0.0',
    );
    const parsed = parseReleaseManifest({
      ...legacy,
      entries: [{ id: 'old', date: '2026-10-01', summaries: { en: ['Old.'] } }],
    });
    expect(parsed?.entryIds).toEqual(['old']);
    expect(parsed?.entries).toEqual([]);
    expect(parseReleaseManifest({ ...legacy, version: 'next' })).toBeNull();
  });

  test('uses translated copy with English fallback', () => {
    const localized = createReleaseManifest(
      [
        {
          ...note('new'),
          summaries: { en: ['Clearer trip days.'], fr: ['Des journées plus claires.'] },
        },
      ],
      'build-b',
      '1.0.0',
    );
    expect(unseenSummaries(localized, old, [], 'fr')[0]?.lines[0]?.text).toBe(
      'Des journées plus claires.',
    );
    expect(unseenSummaries(localized, old, [], 'de')[0]?.lines[0]?.text).toBe('Clearer trip days.');
  });

  test('initializes the first install without replaying history, then preserves IDs through rollbacks and tabs', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    const first = rememberInstalledEntries(old.entryIds);
    expect(first).toEqual(['old']);
    expect(unseenSummaries(old, old, first, 'en')).toEqual([]);
    const installed = rememberInstalledEntries(target.entryIds, first);
    const rollback = rememberInstalledEntries(old.entryIds, first);
    expect(rollback).toEqual(installed);
    expect(unseenSummaries(target, old, rollback, 'en')).toEqual([]);
    // A storage event can recover an installation lost to a concurrent write.
    values.set(
      INSTALLED_CHANGELOG_KEY,
      JSON.stringify({ schemaVersion: 1, appId: 'trove-web', entryIds: ['old'] }),
    );
    expect(rememberInstalledEntries(old.entryIds, installed)).toEqual(installed);
  });

  test('corrupt or blocked storage falls back to the running app and in-memory history', () => {
    expect(parseInstalledHistory('{bad')).toEqual([]);
    expect(parseInstalledHistory(JSON.stringify({ schemaVersion: 2, entryIds: ['old'] }))).toEqual(
      [],
    );
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('blocked');
      },
    });
    expect(rememberInstalledEntries(['old'], ['middle'])).toEqual(['old', 'middle']);
  });
});

describe('PR changelog decisions', () => {
  test('requires added to correspond to new IDs, rather than edits', () => {
    expect(() =>
      checkChangelogDeclaration('Changelog: added', ['old'], ['old', 'new']),
    ).not.toThrow();
    expect(() => checkChangelogDeclaration('Changelog: added', ['old'], ['old'])).toThrow(
      /new entry/,
    );
    expect(() =>
      checkChangelogDeclaration('Changelog: none — Refactor only', ['old'], ['old']),
    ).not.toThrow();
    expect(() => checkChangelogDeclaration('Changelog: none - Refactor only', [], ['new'])).toThrow(
      /require/,
    );
    expect(() => checkChangelogDeclaration('Changelog: none — ', [], [])).toThrow();
    expect(() => checkChangelogDeclaration('<!-- Changelog: added -->', [], ['new'])).toThrow(
      /exactly one/,
    );
    expect(() =>
      checkChangelogDeclaration('Changelog: added\nChangelog: none - Internal', [], ['new']),
    ).toThrow(/exactly one/);
    expect(() => checkChangelogDeclaration('Changelog: added', ['removed'], ['new'])).toThrow(
      /Preserve/,
    );
  });
});

describe('PR version bumps', () => {
  const input = (overrides: Partial<VersionCheckInput> = {}): VersionCheckInput => ({
    changedFiles: [],
    versions: { web: { base: '1.0.0', head: '1.0.0' }, api: { base: '1.0.0', head: '1.0.0' } },
    baseEntries: [{ id: 'old', version: '1.0.0' }],
    headEntries: [note('old')],
    ...overrides,
  });
  const bumped = { base: '1.0.0', head: '1.0.1' };

  test('every deployed change bumps the app that ships it', () => {
    expect(() => checkVersions(input({ changedFiles: ['apps/web/app/page.tsx'] }))).toThrow(
      /bump apps\/web/,
    );
    expect(() =>
      checkVersions(
        input({
          changedFiles: ['apps/web/app/page.tsx'],
          versions: { web: bumped, api: { base: '1.0.0', head: '1.0.0' } },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      checkVersions(input({ changedFiles: ['packages/db/prisma/schema.prisma'] })),
    ).toThrow(/bump apps\/api/);
    // Shared contracts deploy with both apps.
    expect(() =>
      checkVersions(
        input({
          changedFiles: ['packages/types/src/health.ts'],
          versions: { web: bumped, api: { base: '1.0.0', head: '1.0.0' } },
        }),
      ),
    ).toThrow(/bump apps\/api/);
  });

  test('tests, docs and tooling outside the apps need no bump', () => {
    expect(() =>
      checkVersions(
        input({
          changedFiles: [
            'apps/web/test/update-changelog.test.ts',
            'apps/api/src/services/health.test.ts',
            'apps/web/README.md',
            'AGENTS.md',
            'scripts/check-versions.mjs',
          ],
        }),
      ),
    ).not.toThrow();
  });

  test('versions never go backwards and stay well formed', () => {
    expect(() =>
      checkVersions(input({ versions: { web: { base: '1.2.0', head: '1.1.9' }, api: bumped } })),
    ).toThrow(/must not go back/);
    expect(() =>
      checkVersions(input({ versions: { web: { base: '1.0.0', head: 'next' }, api: bumped } })),
    ).toThrow(/major.minor.patch/);
  });

  test('new notes use this PR web version and shipped notes keep theirs', () => {
    const versions = { web: bumped, api: { base: '1.0.0', head: '1.0.0' } };
    expect(() =>
      checkVersions(
        input({ versions, headEntries: [note('old'), note('new', '2026-10-12', '1.0.1')] }),
      ),
    ).not.toThrow();
    expect(() =>
      checkVersions(
        input({ versions, headEntries: [note('old'), note('new', '2026-10-12', '1.0.0')] }),
      ),
    ).toThrow(/must use this PR's web version 1.0.1/);
    expect(() =>
      checkVersions(input({ versions, headEntries: [note('old', '2026-10-11', '1.0.1')] })),
    ).toThrow(/shipped in 1.0.0/);
    // Notes written before versioning may take their first version.
    expect(() =>
      checkVersions(input({ versions, baseEntries: [{ id: 'old' }], headEntries: [note('old')] })),
    ).not.toThrow();
  });
});

describe('worker metadata protocol', () => {
  test('unavailable message channels keep the generic update usable', async () => {
    vi.stubGlobal(
      'MessageChannel',
      class {
        constructor() {
          throw new Error('unavailable');
        }
      },
    );
    expect(
      await requestWorkerRelease({ postMessage: vi.fn() } as unknown as ServiceWorker),
    ).toBeNull();
  });

  test('requests the exact supplied worker and validates its reply', async () => {
    const release = createReleaseManifest([note('new')], 'waiting-build', '1.0.0');
    const postMessage = vi.fn((_message, ports: MessagePort[]) => ports[0]?.postMessage(release));
    expect(await requestWorkerRelease({ postMessage } as unknown as ServiceWorker)).toEqual(
      release,
    );
    expect(postMessage.mock.calls[0]?.[0]).toEqual({ type: 'TROVE_GET_RELEASE' });
    const invalid = {
      postMessage: (_message: unknown, ports: MessagePort[]) =>
        ports[0]?.postMessage({ buildId: 'wrong' }),
    };
    expect(await requestWorkerRelease(invalid as unknown as ServiceWorker)).toBeNull();
  });

  test('legacy workers time out, and posting failures remain nonfatal', async () => {
    vi.useFakeTimers();
    const response = requestWorkerRelease({ postMessage: vi.fn() } as unknown as ServiceWorker);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await response).toBeNull();
    expect(
      await requestWorkerRelease({
        postMessage() {
          throw new Error('redundant');
        },
      } as unknown as ServiceWorker),
    ).toBeNull();
  });
});
