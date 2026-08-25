import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

import {
  type ProductionOperation,
  validateProductionEnvironment,
} from '../src/services/production-operations.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const productionEnvironmentPath = resolve(repositoryRoot, '.env.production');
const PRODUCTION_ENVIRONMENT_KEYS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'PEXELS_API_KEY',
  'SHADOW_DATABASE_URL',
  'TROVE_EDITORIAL_IMAGES_DISABLED',
  'TROVE_EDITORIAL_IMAGE_HOURLY_BUDGET',
  'TROVE_ENVIRONMENT',
] as const;

function parseOperation(value: string | undefined): ProductionOperation {
  if (value === 'migrate' || value === 'reconcile') return value;
  throw new Error('Choose either the migrate or reconcile production operation.');
}

function loadProductionEnvironment() {
  if (!existsSync(productionEnvironmentPath)) {
    throw new Error('.env.production is missing. Copy .env.production.example and fill it in.');
  }

  for (const key of PRODUCTION_ENVIRONMENT_KEYS) {
    delete process.env[key];
  }

  const loaded = config({ override: true, path: productionEnvironmentPath, quiet: true });
  if (loaded.error) throw new Error('Unable to load .env.production.');
}

async function run() {
  const operation = parseOperation(process.argv[2]);
  const argumentsForOperation = process.argv.slice(3).filter((argument) => argument !== '--');
  loadProductionEnvironment();

  const target = validateProductionEnvironment(process.env, operation, {
    activeRefresh: argumentsForOperation.includes('--refresh'),
  });

  const command =
    operation === 'migrate'
      ? resolve(repositoryRoot, 'packages/db/node_modules/.bin/prisma')
      : resolve(repositoryRoot, 'apps/api/node_modules/.bin/tsx');
  const args =
    operation === 'migrate'
      ? ['migrate', 'deploy', ...argumentsForOperation]
      : [
          resolve(repositoryRoot, 'apps/api/scripts/reconcile-editorial-images.ts'),
          ...argumentsForOperation,
        ];
  const cwd = operation === 'migrate' ? resolve(repositoryRoot, 'packages/db') : repositoryRoot;

  console.log(`Validated production ${operation} target: ${target.host}`);

  await new Promise<void>((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' });

    child.once('error', rejectProcess);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveProcess();
        return;
      }

      rejectProcess(
        new Error(
          signal
            ? `Production ${operation} stopped by ${signal}.`
            : `Production ${operation} exited with status ${code ?? 1}.`,
        ),
      );
    });
  });
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Production operation failed.');
  process.exitCode = 1;
});
