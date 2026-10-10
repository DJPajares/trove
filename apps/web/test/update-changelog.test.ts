import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { readChangelogCatalog } from '../lib/updates/catalog.ts';
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
import { requestWorkerRelease } from '../lib/updates/worker.ts';

function note(id: string, date = '2026-10-11'): ChangelogEntry {
  return { id, date, summaries: { en: [`Your trip feels clearer with ${id}.`] } };
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
    const release = createReleaseManifest(entries, 'build-a');
    expect(release.entryIds).toHaveLength(103);
    expect(release.entries).toHaveLength(100);
    expect(release.entries.every((entry) => entry.date === '2026-10-11')).toBe(true);
    expect(() => createReleaseManifest([note('same'), note('same')], 'build-a')).toThrow(
      /Duplicate/,
    );
    expect(() => createReleaseManifest([], '')).toThrow(/build ID/);
  });

  test('requires filenames and year folders to match the entry', () => {
    const directory = mkdtempSync(join(tmpdir(), 'trove-changelog-'));
    try {
      mkdirSync(join(directory, '2026'));
      writeFileSync(join(directory, '2026', 'trip-days.json'), JSON.stringify(note('trip-days')));
      expect(readChangelogCatalog(directory)).toEqual([note('trip-days')]);
      writeFileSync(join(directory, '2026', 'wrong-name.json'), JSON.stringify(note('other')));
      expect(() => readChangelogCatalog(directory)).toThrow(/filename\/year/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects incompatible, duplicate, or unregistered worker metadata', () => {
    const valid = createReleaseManifest([note('days')], 'build-a');
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
  const old = createReleaseManifest([note('old')], 'build-a');
  const target = createReleaseManifest([note('old'), note('middle'), note('newest')], 'build-c');

  test('includes skipped updates while excluding the running build and installed history', () => {
    expect(unseenSummaries(target, old, [], 'en').map((line) => line.id)).toEqual([
      'middle:0',
      'newest:0',
    ]);
    expect(unseenSummaries(target, old, ['middle'], 'en').map((line) => line.id)).toEqual([
      'newest:0',
    ]);
    expect(unseenSummaries(target, target, [], 'en')).toEqual([]);
    expect(unseenSummaries(target, null, [], 'en')).toEqual([]);
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
    );
    expect(unseenSummaries(localized, old, [], 'fr')[0]?.text).toBe('Des journées plus claires.');
    expect(unseenSummaries(localized, old, [], 'de')[0]?.text).toBe('Clearer trip days.');
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
    const release = createReleaseManifest([note('new')], 'waiting-build');
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
