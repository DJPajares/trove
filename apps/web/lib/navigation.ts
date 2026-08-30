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

export function isToolsPath(pathname: string) {
  return isNavigationPathActive(pathname, '/tools');
}
