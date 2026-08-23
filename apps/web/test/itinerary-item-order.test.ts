import { expect, test } from 'vitest';

import { itemSortMinute, reslotItemByTime, timedInsertIndex } from '@/lib/itinerary/item-order';

const at = (id: string, localStartTime: string) => ({ dayPart: null, id, localStartTime });
const during = (id: string, dayPart: 'afternoon' | 'anytime' | 'evening' | 'morning') => ({
  dayPart,
  id,
  localStartTime: null,
});
const untimed = (id: string) => ({ dayPart: null, id, localStartTime: null });
const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

test('the sort key matches the server rule', () => {
  expect(itemSortMinute(at('a', '09:30'))).toBe(570);
  expect(itemSortMinute(during('a', 'morning'))).toBe(0);
  expect(itemSortMinute(during('a', 'afternoon'))).toBe(720);
  expect(itemSortMinute(during('a', 'evening'))).toBe(1020);
  expect(itemSortMinute(during('a', 'anytime'))).toBeNull();
  expect(itemSortMinute(untimed('a'))).toBeNull();
});

test('the insert boundary matches the server rule', () => {
  const day = [at('a', '08:00'), at('b', '14:00')];
  expect(timedInsertIndex(day, 540)).toBe(1);
  expect(timedInsertIndex(day, 480)).toBe(1);
  expect(timedInsertIndex(day, 420)).toBe(0);
});

test('an appended timed item moves back to where its clock puts it', () => {
  // What the offline store does: push, then re-slot.
  const items = [at('a', '08:00'), at('b', '14:00'), at('new', '09:00')];
  reslotItemByTime(items, 'new');
  expect(ids(items)).toEqual(['a', 'new', 'b']);
});

test('an appended untimed item stays where it was appended', () => {
  const items = [at('a', '08:00'), at('b', '14:00'), untimed('new')];
  reslotItemByTime(items, 'new');
  expect(ids(items)).toEqual(['a', 'b', 'new']);
});

test('retiming an item to the earliest time moves it to the front', () => {
  const items = [at('a', '08:00'), at('b', '14:00'), at('c', '18:00')];
  items[2] = at('c', '07:00');
  reslotItemByTime(items, 'c');
  expect(ids(items)).toEqual(['c', 'a', 'b']);
});

test('untimed anchors keep their index when a timed item is inserted', () => {
  const items = [untimed('anchor'), at('a', '08:00'), at('new', '07:00')];
  reslotItemByTime(items, 'new');
  expect(ids(items)).toEqual(['anchor', 'new', 'a']);
});

test('re-slotting an unknown id is a no-op', () => {
  const items = [at('a', '08:00'), at('b', '14:00')];
  reslotItemByTime(items, 'missing');
  expect(ids(items)).toEqual(['a', 'b']);
});
