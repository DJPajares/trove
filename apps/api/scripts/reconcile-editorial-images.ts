import { parseArgs } from 'node:util';

import { getPrismaClient } from '@trove/db';

import {
  DEFAULT_RECONCILIATION_DELAY_MS,
  DEFAULT_RECONCILIATION_LIMIT,
  DEFAULT_RECONCILIATION_PROVIDER_CALLS,
  MAX_RECONCILIATION_PROVIDER_CALLS,
  MIN_RECONCILIATION_DELAY_MS,
  reconcileEditorialImages,
  type EditorialImageReconciliationOptions,
} from '../src/services/editorial-image-reconciliation.js';
import { TROVE_PLACE_CATEGORIES, type TrovePlaceCategory } from '../src/services/places.js';

const HELP = `Usage:
  pnpm editorial-images:reconcile [-- options]
  pnpm editorial-images:reconcile:prod [-- options]

Default: report outdated image sets without writing or calling Pexels.

Options:
  --apply                  Invalidate selected sets without provider calls.
  --refresh                With --apply, refresh selected sets serially.
  --all                    Include current-version sets as well as outdated sets.
  --category <category>    Restrict to a Trove place category.
  --place-id <uuid>        Restrict to a canonical provider Place.
  --limit <count>          Maximum selected sets (default: 10; maximum: 100).
  --cursor <uuid>          Resume after a previously reported image-set cursor.
  --max-provider-calls <n> Outbound request ceiling (default: 10; maximum: 25).
  --delay-ms <ms>          Minimum delay between calls (default: 5000; minimum: 1000).
  --help                   Print this help.`;

function positiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  maximum: number,
  minimum = 1,
) {
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }

  return parsed;
}

function parseCategory(value: string | undefined): TrovePlaceCategory | undefined {
  if (value === undefined) return undefined;

  if (!TROVE_PLACE_CATEGORIES.includes(value as TrovePlaceCategory)) {
    throw new Error(`--category must be one of: ${TROVE_PLACE_CATEGORIES.join(', ')}.`);
  }

  return value as TrovePlaceCategory;
}

function parseOptions(argv: string[]): EditorialImageReconciliationOptions | null {
  const { values } = parseArgs({
    args: argv.filter((argument) => argument !== '--'),
    options: {
      all: { default: false, type: 'boolean' },
      apply: { default: false, type: 'boolean' },
      category: { type: 'string' },
      cursor: { type: 'string' },
      'delay-ms': { type: 'string' },
      help: { default: false, type: 'boolean' },
      limit: { type: 'string' },
      'max-provider-calls': { type: 'string' },
      'place-id': { type: 'string' },
      refresh: { default: false, type: 'boolean' },
    },
    strict: true,
  });

  if (values.help) return null;
  if (values.refresh && !values.apply) {
    throw new Error('--refresh requires --apply.');
  }

  return {
    apply: values.apply,
    category: parseCategory(values.category),
    cursor: values.cursor,
    delayMs: positiveInteger(
      values['delay-ms'],
      '--delay-ms',
      DEFAULT_RECONCILIATION_DELAY_MS,
      60_000,
      MIN_RECONCILIATION_DELAY_MS,
    ),
    limit: positiveInteger(values.limit, '--limit', DEFAULT_RECONCILIATION_LIMIT, 100),
    maxProviderCalls: positiveInteger(
      values['max-provider-calls'],
      '--max-provider-calls',
      DEFAULT_RECONCILIATION_PROVIDER_CALLS,
      MAX_RECONCILIATION_PROVIDER_CALLS,
    ),
    placeId: values['place-id'],
    refresh: values.refresh,
    scope: values.all ? 'all' : 'outdated',
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));

  if (!options) {
    console.log(HELP);
    return;
  }

  try {
    const report = await reconcileEditorialImages(options);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await getPrismaClient().$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Editorial-image reconciliation failed.');
  process.exitCode = 1;
});
