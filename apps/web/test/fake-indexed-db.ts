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
  private active = true;
  private queued: (() => void)[] = [];
  block() {
    this.active = false;
  }
  start() {
    this.active = true;
    for (const action of this.queued.splice(0)) queueMicrotask(action);
  }
  schedule(action: () => void) {
    if (this.active) queueMicrotask(action);
    else this.queued.push(action);
  }

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
    transaction.schedule(() => {
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
  private current: FakeTransaction | null = null;
  private waiting: FakeTransaction[] = [];
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
    const transaction = new FakeTransaction(
      this,
      Array.isArray(storeNames) ? storeNames : [storeNames],
    );
    if (this.current) {
      transaction.block();
      this.waiting.push(transaction);
    } else this.current = transaction;
    transaction.addEventListener(
      'complete',
      () => {
        this.current = this.waiting.shift() ?? null;
        this.current?.start();
      },
      { once: true },
    );
    return transaction;
  }
}

class FakeOpenRequest extends EventTarget {
  result = new FakeDatabase();
}

export class FakeIndexedDbFactory {
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
