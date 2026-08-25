import { expect, test } from 'vitest';

import { validateProductionEnvironment } from '../src/services/production-operations.js';

const production = {
  DATABASE_URL:
    'postgresql://postgres.project:example@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true&schema=trove',
  DIRECT_URL:
    'postgresql://postgres.project:example@aws-0-region.pooler.supabase.com:5432/postgres?schema=trove',
  PEXELS_API_KEY: 'example-provider-key',
  TROVE_ENVIRONMENT: 'production',
};

test('a production migration accepts only an explicitly marked Supabase session connection', () => {
  expect(validateProductionEnvironment(production, 'migrate')).toStrictEqual({
    host: 'aws-0-region.pooler.supabase.com',
  });
  expect(() =>
    validateProductionEnvironment({ ...production, TROVE_ENVIRONMENT: undefined }, 'migrate'),
  ).toThrow('TROVE_ENVIRONMENT=production');
  expect(() =>
    validateProductionEnvironment(
      {
        ...production,
        DIRECT_URL: 'postgresql://postgres:example@localhost:5432/postgres?schema=trove',
      },
      'migrate',
    ),
  ).toThrow('Supabase direct or session connection');
  expect(() =>
    validateProductionEnvironment(
      { ...production, DIRECT_URL: production.DIRECT_URL.replace(':5432/', ':6543/') },
      'migrate',
    ),
  ).toThrow('port 5432');
});

test('production operations reject a connection targeting another schema', () => {
  expect(() =>
    validateProductionEnvironment(
      { ...production, DIRECT_URL: production.DIRECT_URL.replace('schema=trove', 'schema=public') },
      'migrate',
    ),
  ).toThrow('trove schema');
  expect(() =>
    validateProductionEnvironment(
      {
        ...production,
        DATABASE_URL: production.DATABASE_URL.replace('schema=trove', 'schema=public'),
      },
      'reconcile',
    ),
  ).toThrow('trove schema');
});

test('production reconciliation requires a transaction-pooler runtime connection', () => {
  expect(validateProductionEnvironment(production, 'reconcile')).toStrictEqual({
    host: 'aws-0-region.pooler.supabase.com',
  });
  expect(() =>
    validateProductionEnvironment(
      { ...production, DATABASE_URL: production.DATABASE_URL.replace(':6543/', ':5432/') },
      'reconcile',
    ),
  ).toThrow('port 6543');
  expect(() =>
    validateProductionEnvironment(
      {
        ...production,
        DATABASE_URL: production.DATABASE_URL.replace('pgbouncer=true', 'pgbouncer=false'),
      },
      'reconcile',
    ),
  ).toThrow('pgbouncer=true');
});

test('a Pexels key is required only when production reconciliation actively refreshes', () => {
  const noProvider = { ...production, PEXELS_API_KEY: undefined };

  expect(() => validateProductionEnvironment(noProvider, 'reconcile')).not.toThrow();
  expect(() =>
    validateProductionEnvironment(noProvider, 'reconcile', { activeRefresh: true }),
  ).toThrow('PEXELS_API_KEY');
});
