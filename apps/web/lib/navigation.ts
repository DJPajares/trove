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
 * Whether a path is inside one of a trip's own experiences - Trip Mode, or the
 * Memories journal.
 *
 * Each brings its own controls to the bottom of the phone - Trip Mode its Now /
 * Today / Map / Trip bar, the journal its dock - and two stacked navigations on
 * one phone screen is one too many, so the global bar and its create action
 * step aside while a traveller is in either. Leaving is never more than the
 * Exit in the experience's own top bar.
 */
export function isImmersiveTripPath(pathname: string) {
  return /^\/trips\/[^/]+\/(?:mode|memories)(?:\/|$)/.test(pathname);
}

export function isToolsPath(pathname: string) {
  return isNavigationPathActive(pathname, '/tools');
}
