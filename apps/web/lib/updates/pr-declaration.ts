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
