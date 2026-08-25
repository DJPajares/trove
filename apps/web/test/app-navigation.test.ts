import { expect, test } from 'vitest';

import {
  defaultToolPath,
  isAppMenuPath,
  isNavigationPathActive,
  isToolsPath,
  primaryNavigationDestinations,
  toolNavigationDestinations,
} from '../lib/navigation.ts';

test('global navigation keeps only its three stable primary destinations', () => {
  expect(primaryNavigationDestinations.map(({ href }) => href)).toEqual(['/', '/trips', '/saved']);
  expect(primaryNavigationDestinations.map(({ column }) => column)).toEqual([
    'col-start-1',
    'col-start-2',
    'col-start-4',
  ]);
});

test('each travel tool has its own address and the legacy tools route has a stable fallback', () => {
  expect(toolNavigationDestinations.map(({ href }) => href)).toEqual([
    '/tools/currency',
    '/tools/task-templates',
  ]);
  expect(defaultToolPath).toBe('/tools/currency');
});

test('navigation activity follows complete path segments', () => {
  expect(isNavigationPathActive('/', '/')).toBe(true);
  expect(isNavigationPathActive('/trips', '/')).toBe(false);
  expect(isNavigationPathActive('/trips/example', '/trips')).toBe(true);
  expect(isNavigationPathActive('/trips-old', '/trips')).toBe(false);
});

test('the app menu owns tool and profile routes without claiming unrelated pages', () => {
  expect(isToolsPath('/tools/currency')).toBe(true);
  expect(isToolsPath('/toolsmith')).toBe(false);
  expect(isAppMenuPath('/tools/task-templates')).toBe(true);
  expect(isAppMenuPath('/profile')).toBe(true);
  expect(isAppMenuPath('/trips')).toBe(false);
});
