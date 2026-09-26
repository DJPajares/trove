import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPrismaClient } from '@trove/db';
import { getStorageCleanupEnvironment } from '../environment.js';

export const MEDIA_CLEANUP_BATCH_SIZE = 100;
const LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS_PER_RUN = 1_000;
const INLINE_ATTEMPTS = 25;
const ABSENCE_CHECK_CONCURRENCY = 10;
const STORAGE_REQUEST_TIMEOUT_MS = 8_000;

type Client = ReturnType<typeof getPrismaClient>;
type CleanupRow = NonNullable<Awaited<ReturnType<Client['tripMediaCleanup']['findFirst']>>>;
export type CleanupReport = {
  attempted: number;
  removed: number;
  pending: number;
  oldestPendingAgeSeconds: number | null;
};

export function createStorageCleanupClient(): SupabaseClient | null {
  const config = getStorageCleanupEnvironment();
  if (!config) return null;
  return createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: {
      fetch: (input, init) => {
        const signals = [AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS)];
        if (init?.signal) signals.push(init.signal);
        if (input instanceof Request) signals.push(input.signal);
        return fetch(input, { ...init, signal: AbortSignal.any(signals) });
      },
    },
  });
}

function retryAt(attemptCount: number, now: Date) {
  return new Date(now.getTime() + Math.min(24 * 60, 5 * 2 ** Math.min(attemptCount, 9)) * 60_000);
}

/** Claim without holding a database transaction open during network I/O. */
async function claim(prisma: Client, now: Date, tripId: string | null, limit: number) {
  const candidates = await prisma.tripMediaCleanup.findMany({
    where: {
      ...(tripId ? { tripId } : {}),
      nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  });
  const claimed: CleanupRow[] = [];
  for (const row of candidates) {
    const token = randomUUID();
    const result = await prisma.tripMediaCleanup.updateMany({
      where: {
        id: row.id,
        nextAttemptAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: { leaseToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (result.count === 1) claimed.push({ ...row, leaseToken: token });
  }
  return claimed;
}

async function settle(prisma: Client, row: CleanupRow, removed: boolean, now: Date) {
  const where = { id: row.id, leaseToken: row.leaseToken };
  if (removed) {
    await prisma.tripMediaCleanup.deleteMany({ where });
  } else {
    await prisma.tripMediaCleanup.updateMany({
      where,
      data: {
        attemptCount: row.attemptCount + 1,
        leaseToken: null,
        leaseUntil: null,
        nextAttemptAt: retryAt(row.attemptCount, now),
      },
    });
  }
}

/** Only the API's privileged client can confirm absence after an ambiguous batch. */
async function absent(client: SupabaseClient, bucket: string, path: string) {
  const { error } = await client.storage.from(bucket).info(path);
  return error?.statusCode === '404' || error?.status === 404;
}

export async function processTripMediaCleanup(
  options: {
    client?: SupabaseClient | null;
    limit?: number;
    now?: Date;
    prisma?: Client;
    tripId?: string;
  } = {},
): Promise<CleanupReport> {
  const prisma = options.prisma ?? getPrismaClient();
  const client = options.client === undefined ? createStorageCleanupClient() : options.client;
  if (!client) throw new Error('storage_cleanup_configuration_missing');
  const now = options.now ?? new Date();
  const limit = Math.max(0, Math.min(options.limit ?? MAX_ATTEMPTS_PER_RUN, MAX_ATTEMPTS_PER_RUN));
  const rows = await claim(prisma, now, options.tripId ?? null, limit);
  let removed = 0;
  for (const bucket of ['trip-covers', 'memory-photos', 'reservation-documents']) {
    const bucketRows = rows.filter((row) => row.bucket === bucket);
    for (let index = 0; index < bucketRows.length; index += MEDIA_CLEANUP_BATCH_SIZE) {
      const batch = bucketRows.slice(index, index + MEDIA_CLEANUP_BATCH_SIZE);
      const confirmed = new Set<string>();
      try {
        const result = await client.storage.from(bucket).remove(batch.map((row) => row.path));
        if (!result.error) {
          const requested = new Set(batch.map((row) => row.path));
          for (const object of result.data ?? []) {
            if (requested.has(object.name)) confirmed.add(object.name);
          }
        }
      } catch {
        // The queue is the recovery path for network failures and timeouts.
      }
      // Storage can return an empty or partial success response. Check every
      // unconfirmed path, including after a failed batch, before retrying it.
      const uncertain = batch.filter((row) => !confirmed.has(row.path));
      for (let offset = 0; offset < uncertain.length; offset += ABSENCE_CHECK_CONCURRENCY) {
        await Promise.all(
          uncertain.slice(offset, offset + ABSENCE_CHECK_CONCURRENCY).map(async (row) => {
            try {
              if (await absent(client, bucket, row.path)) confirmed.add(row.path);
            } catch {
              // An uncertain or unreachable object remains queued.
            }
          }),
        );
      }
      for (const row of batch) {
        const success = confirmed.has(row.path);
        await settle(prisma, row, success, now);
        if (success) removed += 1;
      }
    }
  }
  const [pending, oldest] = await Promise.all([
    prisma.tripMediaCleanup.count(),
    prisma.tripMediaCleanup.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);
  return {
    attempted: rows.length,
    removed,
    pending,
    oldestPendingAgeSeconds: oldest
      ? Math.max(0, Math.floor((now.getTime() - oldest.createdAt.getTime()) / 1_000))
      : null,
  };
}

/** A deletion response is based on the committed DB transaction, not Storage health. */
export async function attemptNewTripMediaCleanup(tripId: string) {
  try {
    await processTripMediaCleanup({ tripId, limit: INLINE_ATTEMPTS });
  } catch {
    // The guarded maintenance job retries the durable obligation.
  }
}
