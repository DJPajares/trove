import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';
import { getDatabaseEnvironment } from './environment.js';

type PrismaClientGlobal = typeof globalThis & {
  trovePrismaClient?: PrismaClient;
};

const prismaClientGlobal = globalThis as PrismaClientGlobal;

export function createPrismaClient() {
  const { DATABASE_URL } = getDatabaseEnvironment();
  const adapter = new PrismaPg(
    {
      connectionString: DATABASE_URL,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      max: 1,
    },
    { schema: 'trove' },
  );

  return new PrismaClient({ adapter });
}

export function getPrismaClient() {
  prismaClientGlobal.trovePrismaClient ??= createPrismaClient();

  return prismaClientGlobal.trovePrismaClient;
}

export async function checkDatabaseConnection() {
  await getPrismaClient().$queryRaw`SELECT 1`;
}
