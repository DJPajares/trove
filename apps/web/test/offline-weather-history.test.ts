import { afterEach, expect, test, vi } from 'vitest';

import {
  clearAllOfflineTripData,
  readTripWeatherHistory,
  removeTripOfflineData,
  writeTripWeatherHistory,
} from '../lib/offline/trip-store.ts';
import type { ArchivedTripWeatherDay } from '../lib/weather/history.ts';

type FakeRecord = Record<string, unknown>;
type FakeKeyRange = { value: unknown };
type FakeStoreDefinition = {
  indexes: Map<string, string | string[]>;
  keyPath: string;
  records: Map<string, FakeRecord>;
};

function key(value: unknown) {
  return JSON.stringify(value);
}

function valueAtPath(record: FakeRecord, path: string | string[]) {
  return Array.isArray(path) ? path.map((part) => record[part]) : record[path];
}

class FakeTransaction extends EventTarget {
  private completionScheduled = false;

  constructor(
    private readonly database: FakeDatabase,
    private readonly allowedStores: string[],
  ) {
    super();
  }

  objectStore(name: string) {
    if (!this.allowedStores.includes(name)) throw new Error(`Store not in transaction: ${name}`);
    const definition = this.database.stores.get(name);
    if (!definition) throw new Error(`Unknown store: ${name}`);
    return new FakeObjectStore(definition, this);
  }

  finishSoon() {
    if (this.completionScheduled) return;
    this.completionScheduled = true;
    queueMicrotask(() => queueMicrotask(() => this.dispatchEvent(new Event('complete'))));
  }
}

class FakeRequest<T> extends EventTarget {
  result!: T;
  error: DOMException | null = null;

  constructor(action: () => T, transaction: FakeTransaction) {
    super();
    queueMicrotask(() => {
      try {
        this.result = action();
        this.dispatchEvent(new Event('success'));
      } catch (error) {
        this.error = error as DOMException;
        this.dispatchEvent(new Event('error'));
      }
      transaction.finishSoon();
    });
  }
}

class FakeIndex {
  constructor(
    private readonly definition: FakeStoreDefinition,
    private readonly transaction: FakeTransaction,
    private readonly keyPath: string | string[],
  ) {}

  getAll(range?: FakeKeyRange) {
    return new FakeRequest(
      () =>
        [...this.definition.records.values()].filter((record) =>
          range ? key(valueAtPath(record, this.keyPath)) === key(range.value) : true,
        ),
      this.transaction,
    );
  }

  getAllKeys(range?: FakeKeyRange) {
    return new FakeRequest(
      () =>
        [...this.definition.records.entries()]
          .filter(([, record]) =>
            range ? key(valueAtPath(record, this.keyPath)) === key(range.value) : true,
          )
          .map(([recordKey]) => recordKey),
      this.transaction,
    );
  }
}

class FakeObjectStore {
  constructor(
    private readonly definition: FakeStoreDefinition,
    private readonly transaction: FakeTransaction,
  ) {}

  createIndex(name: string, keyPath: string | string[]) {
    this.definition.indexes.set(name, keyPath);
  }

  index(name: string) {
    const keyPath = this.definition.indexes.get(name);
    if (!keyPath) throw new Error(`Unknown index: ${name}`);
    return new FakeIndex(this.definition, this.transaction, keyPath);
  }

  get(recordKey: string) {
    return new FakeRequest(() => this.definition.records.get(recordKey), this.transaction);
  }

  put(record: FakeRecord) {
    return new FakeRequest(() => {
      const recordKey = record[this.definition.keyPath];
      if (typeof recordKey !== 'string') throw new Error('Missing string key');
      this.definition.records.set(recordKey, record);
      return recordKey;
    }, this.transaction);
  }

  delete(recordKey: string) {
    return new FakeRequest(() => {
      this.definition.records.delete(recordKey);
      return undefined;
    }, this.transaction);
  }

  clear() {
    return new FakeRequest(() => {
      this.definition.records.clear();
      return undefined;
    }, this.transaction);
  }
}

class FakeDatabase {
  readonly stores = new Map<string, FakeStoreDefinition>();
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };

  createObjectStore(name: string, { keyPath }: { keyPath: string }) {
    const definition = {
      indexes: new Map(),
      keyPath,
      records: new Map(),
    } satisfies FakeStoreDefinition;
    this.stores.set(name, definition);
    return new FakeObjectStore(definition, new FakeTransaction(this, [name]));
  }

  transaction(storeNames: string | string[]) {
    return new FakeTransaction(this, Array.isArray(storeNames) ? storeNames : [storeNames]);
  }
}

class FakeOpenRequest extends EventTarget {
  result = new FakeDatabase();
}

class FakeIndexedDbFactory {
  private readonly database = new FakeDatabase();

  open() {
    const request = new FakeOpenRequest();
    request.result = this.database;
    queueMicrotask(() => {
      request.dispatchEvent(new Event('upgradeneeded'));
      queueMicrotask(() => request.dispatchEvent(new Event('success')));
    });
    return request;
  }
}

const archivedDay: ArchivedTripWeatherDay = {
  date: '2026-09-20',
  itineraryDayId: 'past-day',
  location: { timeZone: 'Asia/Tokyo' },
  precipitationProbability: 20,
  temperatureMaxCelsius: 24,
  temperatureMinCelsius: 18,
  weatherCode: 2,
};

afterEach(() => vi.unstubAllGlobals());

test('trip deletion and private data cleanup remove archived forecasts', async () => {
  const browserWindow = Object.assign(new EventTarget(), {
    localStorage: { removeItem: vi.fn() },
  });
  vi.stubGlobal('indexedDB', new FakeIndexedDbFactory() as unknown as IDBFactory);
  vi.stubGlobal('IDBKeyRange', { only: (value: unknown) => ({ value }) });
  vi.stubGlobal('window', browserWindow);

  await writeTripWeatherHistory('traveller', 'trip-to-delete', [archivedDay]);
  await removeTripOfflineData('traveller', 'trip-to-delete');
  expect(await readTripWeatherHistory('traveller', 'trip-to-delete')).toEqual([archivedDay]);

  await removeTripOfflineData('traveller', 'trip-to-delete', { discardPendingMutations: true });
  expect(await readTripWeatherHistory('traveller', 'trip-to-delete')).toEqual([]);

  await writeTripWeatherHistory('traveller', 'another-trip', [archivedDay]);
  await clearAllOfflineTripData();
  expect(await readTripWeatherHistory('traveller', 'another-trip')).toEqual([]);
});
