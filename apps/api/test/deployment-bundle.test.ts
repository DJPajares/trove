import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

/**
 * A workspace package the API imports at runtime is invisible to Vercel unless
 * the deployment build compiles it first: file tracing follows the built entry
 * named by `exports.import`, and a package whose `dist` does not exist yet is
 * silently left out of the bundle. The function then dies at import with
 * ERR_MODULE_NOT_FOUND on *every* route, and because Vercel's own 500 carries no
 * CORS headers the browser reports it as a CORS failure - which is how a missing
 * `@trove/types` build read as an API-wide CORS outage.
 *
 * `dependencies` is the authority here rather than a scan of import statements:
 * a workspace package belongs there exactly when it is needed at runtime, and
 * `devDependencies` (`@trove/config`) is correctly absent from the build.
 */
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(apiRoot, relativePath), 'utf8')) as T;
}

test('the deployment build compiles every workspace package the API needs at runtime', () => {
  const { buildCommand } = readJson<{ buildCommand: string }>('vercel.json');
  const { dependencies } = readJson<{ dependencies: Record<string, string> }>('package.json');

  const workspaceDependencies = Object.entries(dependencies)
    .filter(([, version]) => version.startsWith('workspace:'))
    .map(([name]) => name);

  // Without this the assertions below pass vacuously if the field is ever renamed.
  expect(workspaceDependencies).toContain('@trove/types');
  expect(workspaceDependencies).toContain('@trove/db');

  const apiBuildPosition = buildCommand.indexOf('--filter @trove/api build');
  expect(apiBuildPosition).toBeGreaterThan(-1);

  for (const name of workspaceDependencies) {
    const position = buildCommand.indexOf(`--filter ${name} build`);

    expect(position, `${name} is missing from the deployment build command`).toBeGreaterThan(-1);
    expect(position, `${name} must be built before @trove/api`).toBeLessThan(apiBuildPosition);
  }
});
