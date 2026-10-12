import type { BaseChangelogEntry } from './catalog.ts';
import type { ChangelogEntry } from './release.ts';
import { compareSemver, isSemver } from './version.ts';

export type AppName = 'web' | 'api';

export const APP_PACKAGES: Record<AppName, string> = {
  web: 'apps/web/package.json',
  api: 'apps/api/package.json',
};

/** Sources each deployment is built from; shared contracts ship with both apps. */
const DEPLOY_PATHS: Record<AppName, string[]> = {
  web: ['apps/web/', 'packages/types/'],
  api: ['apps/api/', 'packages/db/', 'packages/types/'],
};

function isDeployedSource(file: string) {
  return !/(^|\/)test\//.test(file) && !/\.test\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.md');
}

export function appsNeedingBump(changedFiles: readonly string[]): AppName[] {
  return (Object.keys(DEPLOY_PATHS) as AppName[]).filter((app) =>
    changedFiles.some(
      (file) =>
        isDeployedSource(file) && DEPLOY_PATHS[app].some((prefix) => file.startsWith(prefix)),
    ),
  );
}

export interface VersionCheckInput {
  changedFiles: readonly string[];
  /** `base` is null when the package did not exist at the PR base. */
  versions: Record<AppName, { base: string | null; head: string }>;
  baseEntries: readonly BaseChangelogEntry[];
  headEntries: readonly ChangelogEntry[];
}

/** Every deployed change bumps its app, and every new note names the web release that ships it. */
export function checkVersions({
  changedFiles,
  versions,
  baseEntries,
  headEntries,
}: VersionCheckInput) {
  const problems: string[] = [];
  const needsBump = appsNeedingBump(changedFiles);
  for (const app of Object.keys(APP_PACKAGES) as AppName[]) {
    const { base, head } = versions[app];
    if (!isSemver(head)) {
      problems.push(`${APP_PACKAGES[app]} needs a major.minor.patch version, not "${head}"`);
      continue;
    }
    if (!base || !isSemver(base)) continue;
    const order = compareSemver(head, base);
    if (order < 0) problems.push(`${app} version must not go back from ${base} to ${head}`);
    else if (order === 0 && needsBump.includes(app)) {
      problems.push(`This PR changes what ${app} deploys; bump ${APP_PACKAGES[app]} past ${base}`);
    }
  }
  const web = versions.web.head;
  const shipped = new Map(baseEntries.map((entry) => [entry.id, entry.version]));
  for (const entry of headEntries) {
    if (!shipped.has(entry.id)) {
      if (entry.version !== web) {
        problems.push(`New changelog ${entry.id} must use this PR's web version ${web}`);
      }
      continue;
    }
    const released = shipped.get(entry.id);
    if (released && released !== entry.version) {
      problems.push(`Changelog ${entry.id} shipped in ${released}; keep that version`);
    }
  }
  if (problems.length) throw new Error(problems.join('\n'));
}
