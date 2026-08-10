import { z } from 'zod';

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;

function validatePooledDatabaseUrl(databaseUrl: string) {
  let url: URL;

  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
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

  validatePooledDatabaseUrl(parsedEnvironment.data.DATABASE_URL);

  return parsedEnvironment.data;
}
