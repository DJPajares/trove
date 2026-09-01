import { expect, test, vi } from 'vitest';

import { SerialAutosave } from '../lib/ai-planning/autosave.ts';

type Result = { revision: number; value: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test('coalesces edits made before a flush into one write', async () => {
  const persist = vi.fn(async (value: string, revision: number) => ({
    revision: revision + 1,
    value,
  }));
  const autosave = new SerialAutosave({
    draft: 'initial',
    getRevision: (result: Result) => result.revision,
    persist,
    result: { revision: 1, value: 'initial' },
    revision: 1,
  });

  autosave.update('first');
  autosave.update('latest');

  await expect(autosave.flush()).resolves.toStrictEqual({ revision: 2, value: 'latest' });
  expect(persist).toHaveBeenCalledOnce();
  expect(persist).toHaveBeenCalledWith('latest', 1);
});

test('serializes an edit made during an in-flight write onto the returned revision', async () => {
  const first = deferred<Result>();
  const persist = vi
    .fn<(value: string, revision: number) => Promise<Result>>()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(async (value, revision) => ({ revision: revision + 1, value }));
  const autosave = new SerialAutosave({
    draft: 'initial',
    getRevision: (result: Result) => result.revision,
    persist,
    result: { revision: 4, value: 'initial' },
    revision: 4,
  });

  autosave.update('first');
  const flushing = autosave.flush();
  autosave.update('second');
  first.resolve({ revision: 5, value: 'first' });

  await expect(flushing).resolves.toStrictEqual({ revision: 6, value: 'second' });
  expect(persist).toHaveBeenNthCalledWith(1, 'first', 4);
  expect(persist).toHaveBeenNthCalledWith(2, 'second', 5);
});

test('pauses after an error until retry is explicitly requested', async () => {
  const failure = new Error('offline');
  const persist = vi
    .fn<(value: string, revision: number) => Promise<Result>>()
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce({ revision: 2, value: 'edited' });
  const autosave = new SerialAutosave({
    draft: 'initial',
    getRevision: (result: Result) => result.revision,
    persist,
    result: { revision: 1, value: 'initial' },
    revision: 1,
  });

  autosave.update('edited');
  await expect(autosave.flush()).rejects.toBe(failure);
  await expect(autosave.flush()).rejects.toBe(failure);
  expect(persist).toHaveBeenCalledOnce();

  await expect(autosave.retry()).resolves.toStrictEqual({ revision: 2, value: 'edited' });
  expect(persist).toHaveBeenCalledTimes(2);
});
