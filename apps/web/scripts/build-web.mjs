import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { readChangelogCatalog } from '../lib/updates/catalog.ts';
import { createReleaseManifest } from '../lib/updates/release.ts';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const release = createReleaseManifest(
  readChangelogCatalog(fileURLToPath(new URL('../changelog/', import.meta.url))),
  randomUUID(),
  require('../package.json').version,
);
const build = spawn(
  process.execPath,
  [require.resolve('next/dist/bin/next'), 'build', ...process.argv.slice(2)],
  {
    cwd: webRoot,
    stdio: 'inherit',
    env: { ...process.env, TROVE_WEB_RELEASE: JSON.stringify(release) },
  },
);
build.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
build.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
