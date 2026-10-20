// Checks web/API version bumps against a PR base: `--pr` in CI, or `--base <ref>` locally.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readChangelogAtRef, readChangelogCatalog } from '../apps/web/lib/updates/catalog.ts';
import { APP_PACKAGES, checkVersions } from '../apps/web/lib/updates/version-check.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const baseFlag = process.argv.indexOf('--base');
const baseRef =
  baseFlag > -1
    ? process.argv[baseFlag + 1]
    : JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request.base.sha;
const base = git('rev-parse', '--verify', `${baseRef}^{commit}`).trim();

function versionAt(ref, path) {
  try {
    return JSON.parse(git('show', `${ref}:${path}`)).version ?? null;
  } catch {
    return null;
  }
}

const versions = Object.fromEntries(
  Object.entries(APP_PACKAGES).map(([app, path]) => [
    app,
    {
      base: versionAt(base, path),
      head: JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')).version,
    },
  ]),
);

checkVersions({
  changedFiles: git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean),
  versions,
  baseEntries: readChangelogAtRef(root, base),
  headEntries: readChangelogCatalog(
    fileURLToPath(new URL('../apps/web/changelog.json', import.meta.url)),
  ),
});
console.log(`Versions valid (web ${versions.web.head}, api ${versions.api.head})`);
