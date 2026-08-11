import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

import { defineConfig } from 'prisma/config';

config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'),
});

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  experimental: {
    externalTables: true,
  },
  tables: {
    external: ['auth.users'],
  },
  datasource: {
    url: process.env.DIRECT_URL ?? '',
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
