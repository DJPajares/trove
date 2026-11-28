// Checks web/API version bumps against a PR base: `--pr` in CI, or `--base <ref>` locally.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readChangelogAtRef, readChangelogCatalog } from '../apps/web/lib/updates/catalog.ts';
import { DEPENDABOT_LOGIN } from '../apps/web/lib/updates/pr-declaration.ts';
import { APP_PACKAGES, checkVersions } from '../apps/web/lib/updates/version-check.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const baseFlag = process.argv.indexOf('--base');
const pullRequest =
  baseFlag > -1
    ? null
    : JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request;
const baseRef = pullRequest ? pullRequest.base.sha : process.argv[baseFlag + 1];
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

try {
  checkVersions({
    changedFiles: git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean),
    versions,
    baseEntries: readChangelogAtRef(root, base),
    headEntries: readChangelogCatalog(
      fileURLToPath(new URL('../apps/web/changelog.json', import.meta.url)),
    ),
  });
} catch (error) {
  // Dependabot cannot bump app versions, so its PRs stay red until the reviewer pushes the bump.
  if (pullRequest?.user?.login !== DEPENDABOT_LOGIN) throw error;
  throw new Error(
    `${error.message}\nDependabot cannot bump app versions: push a patch bump to this branch before merging.`,
  );
}
console.log(`Versions valid (web ${versions.web.head}, api ${versions.api.head})`);
