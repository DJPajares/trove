import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { z } from 'zod';

config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;

function parseDatabaseUrl(databaseUrl: string) {
  try {
    return new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
}

function isLocalDatabaseUrl(url: URL) {
  return ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
}

function validateDatabaseUrl(databaseUrl: string) {
  const url = parseDatabaseUrl(databaseUrl);

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
  }

  if (isLocalDatabaseUrl(url)) {
    if (url.searchParams.get('schema') !== 'trove') {
      throw new Error('Local DATABASE_URL must target the trove schema.');
    }

    return;
  }

  if (!url.hostname.endsWith('.pooler.supabase.com') || url.port !== '6543') {
    throw new Error('DATABASE_URL must use the Supabase transaction pooler on port 6543.');
  }

  if (url.searchParams.get('pgbouncer') !== 'true') {
    throw new Error('DATABASE_URL must set pgbouncer=true for Supavisor.');
  }

  if (url.searchParams.get('schema') !== 'trove') {
    throw new Error('DATABASE_URL must target the trove schema.');
  }
}

export function getDatabaseEnvironment(
  environment: Record<string, string | undefined> = process.env,
): DatabaseEnvironment {
  const parsedEnvironment = databaseEnvironmentSchema.safeParse(environment);

  if (!parsedEnvironment.success) {
    throw new Error('DATABASE_URL is required.');
  }

  validateDatabaseUrl(parsedEnvironment.data.DATABASE_URL);

  return parsedEnvironment.data;
}
