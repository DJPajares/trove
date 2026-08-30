import { expect, test } from 'vitest';

import {
  isNavigationPathActive,
  isToolsPath,
  primaryNavigationDestinations,
  toolNavigationDestinations,
} from '../lib/navigation.ts';

test('global navigation keeps its four stable destinations around the create action', () => {
  expect(primaryNavigationDestinations.map(({ href }) => href)).toEqual([
    '/',
    '/trips',
    '/saved',
    '/tools',
  ]);
  expect(primaryNavigationDestinations.map(({ column }) => column)).toEqual([
    'col-start-1',
    'col-start-2',
    'col-start-4',
    'col-start-5',
  ]);
});

test('each travel tool has its own address beneath the tools launcher', () => {
  expect(toolNavigationDestinations.map(({ href }) => href)).toEqual([
    '/tools/currency',
    '/tools/task-templates',
  ]);
});

test('navigation activity follows complete path segments', () => {
  expect(isNavigationPathActive('/', '/')).toBe(true);
  expect(isNavigationPathActive('/trips', '/')).toBe(false);
  expect(isNavigationPathActive('/trips/example', '/trips')).toBe(true);
  expect(isNavigationPathActive('/trips-old', '/trips')).toBe(false);
});

test('the tools destination owns its launcher and child routes without claiming unrelated pages', () => {
  expect(isToolsPath('/tools')).toBe(true);
  expect(isToolsPath('/tools/currency')).toBe(true);
  expect(isToolsPath('/tools/task-templates')).toBe(true);
  expect(isToolsPath('/toolsmith')).toBe(false);
  expect(isToolsPath('/profile')).toBe(false);
  expect(isToolsPath('/trips')).toBe(false);
});
