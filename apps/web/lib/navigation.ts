export const primaryNavigationDestinations = [
  { column: 'col-start-1', href: '/', key: 'home' },
  { column: 'col-start-2', href: '/trips', key: 'trips' },
  { column: 'col-start-4', href: '/saved', key: 'saved' },
  { column: 'col-start-5', href: '/tools', key: 'tools' },
] as const;

export const toolNavigationDestinations = [
  { href: '/tools/currency', key: 'currency' },
  { href: '/tools/task-templates', key: 'taskTemplates' },
] as const;

export function isNavigationPathActive(pathname: string, href: string) {
  return href === '/' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Whether a path is inside Trip Mode.
 *
 * Trip Mode brings its own bottom bar - Now / Today / Map / Trip - and two
 * stacked navigations on one phone screen is one too many, so the global bar
 * and its create action step aside while a traveller is in it. Leaving is never
 * more than the Exit in Trip Mode's own top bar.
 */
export function isTripModePath(pathname: string) {
  return /^\/trips\/[^/]+\/mode(?:\/|$)/.test(pathname);
}

export function isToolsPath(pathname: string) {
  return isNavigationPathActive(pathname, '/tools');
}
