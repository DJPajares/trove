export function checkChangelogDeclaration(
  body: string,
  previousIds: readonly string[],
  currentIds: readonly string[],
): void {
  // Ignore the template's commented examples rather than accepting an unfilled template.
  const content = body.replace(/<!--[\s\S]*?-->/g, '');
  const declarations = content.split(/\r?\n/).filter((line) => /^Changelog:/i.test(line));
  if (declarations.length !== 1) throw new Error('Provide exactly one Changelog: declaration');
  const declaration = declarations[0] ?? '';
  const added = currentIds.filter((id) => !previousIds.includes(id));
  if (previousIds.some((id) => !currentIds.includes(id))) {
    throw new Error('Preserve historical changelog entries and IDs');
  }
  if (/^Changelog:\s*added\s*$/i.test(declaration)) {
    if (!added.length) throw new Error('Changelog: added requires a new entry ID in this PR');
    return;
  }
  if (/^Changelog:\s*none\s*[—–-]\s*\S.*$/i.test(declaration)) {
    if (added.length) throw new Error('New changelog entries require Changelog: added');
    return;
  }
  throw new Error('Use Changelog: added or Changelog: none — <reason>');
}

/** Dependabot cannot write a changelog declaration, so its PRs carry an implied one. */
export const DEPENDABOT_LOGIN = 'dependabot[bot]';

export interface PullRequestDeclarationSource {
  body?: string | null;
  user?: { login?: string } | null;
}

/**
 * The declaration to check for a PR. A Dependabot body is generated release notes, never a
 * decision, so its PRs declare none, or added once a reviewer pushes a note, and still pass
 * through the history and new-ID checks. Everyone else writes their own.
 */
export function pullRequestDeclaration(
  pullRequest: PullRequestDeclarationSource,
  previousIds: readonly string[],
  currentIds: readonly string[],
): string {
  if (pullRequest.user?.login !== DEPENDABOT_LOGIN) return pullRequest.body ?? '';
  return currentIds.some((id) => !previousIds.includes(id))
    ? 'Changelog: added'
    : 'Changelog: none — dependency update';
}
