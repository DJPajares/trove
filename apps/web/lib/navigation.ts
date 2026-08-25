export const primaryNavigationDestinations = [
  { column: 'col-start-1', href: '/', key: 'home' },
  { column: 'col-start-2', href: '/trips', key: 'trips' },
  { column: 'col-start-4', href: '/saved', key: 'saved' },
] as const;

export const toolNavigationDestinations = [
  { href: '/tools/currency', key: 'currency' },
  { href: '/tools/task-templates', key: 'taskTemplates' },
] as const;

export const defaultToolPath = toolNavigationDestinations[0].href;

export function isNavigationPathActive(pathname: string, href: string) {
  return href === '/' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function isToolsPath(pathname: string) {
  return isNavigationPathActive(pathname, '/tools');
}

export function isAppMenuPath(pathname: string) {
  return isToolsPath(pathname) || isNavigationPathActive(pathname, '/profile');
}
