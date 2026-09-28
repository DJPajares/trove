/** Coalesce only concurrent acquisition. Successful results retain their own cache age. */
const inflight = new Map<string, Promise<unknown>>();
export function singleFlight<T>(key: string, acquire: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = acquire().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}
