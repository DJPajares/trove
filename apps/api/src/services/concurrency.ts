/**
 * `Promise.all` over a day's places or a trip's days issues every request at
 * once. On a cache miss that is a burst straight at the provider, which is both
 * the fastest way to hit a rate limit and the hardest shape to reason about
 * when a bill is unexpected. This keeps the same result and ordering while
 * bounding how many are in flight.
 */
export async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  limit: number,
  map: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (items.length <= limit) return Promise.all(items.map(map));

  const results: Output[] = Array.from({ length: items.length });
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index] as Input;
      results[index] = await map(item, index);
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));

  return results;
}

/** Enough to stay fast on a normal day, low enough to never look like a loop. */
export const PROVIDER_CONCURRENCY_LIMIT = 6;
