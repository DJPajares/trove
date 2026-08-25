export type ProductionOperation = 'migrate' | 'reconcile';

function parseProductionUrl(value: string | undefined, name: 'DATABASE_URL' | 'DIRECT_URL') {
  if (!value?.trim()) throw new Error(`${name} is required in .env.production.`);

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL.`);
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${name} must use the PostgreSQL protocol.`);
  }

  if (url.searchParams.get('schema') !== 'trove') {
    throw new Error(`${name} must target the trove schema.`);
  }

  return url;
}

/** Reject a local or transaction-pooler URL before a production migration starts. */
export function validateProductionEnvironment(
  environment: Record<string, string | undefined>,
  operation: ProductionOperation,
  options: { activeRefresh?: boolean } = {},
) {
  if (environment.TROVE_ENVIRONMENT !== 'production') {
    throw new Error('TROVE_ENVIRONMENT=production is required in .env.production.');
  }

  const direct = parseProductionUrl(environment.DIRECT_URL, 'DIRECT_URL');
  const directHost =
    direct.hostname.endsWith('.pooler.supabase.com') ||
    (direct.hostname.startsWith('db.') && direct.hostname.endsWith('.supabase.co'));

  if (!directHost || direct.port !== '5432') {
    throw new Error('DIRECT_URL must use a Supabase direct or session connection on port 5432.');
  }

  if (operation === 'reconcile') {
    const runtime = parseProductionUrl(environment.DATABASE_URL, 'DATABASE_URL');

    if (!runtime.hostname.endsWith('.pooler.supabase.com') || runtime.port !== '6543') {
      throw new Error('DATABASE_URL must use the Supabase transaction pooler on port 6543.');
    }

    if (runtime.searchParams.get('pgbouncer') !== 'true') {
      throw new Error('DATABASE_URL must set pgbouncer=true.');
    }

    if (options.activeRefresh && !environment.PEXELS_API_KEY?.trim()) {
      throw new Error('PEXELS_API_KEY is required for an active production refresh.');
    }
  }

  return { host: direct.hostname };
}
