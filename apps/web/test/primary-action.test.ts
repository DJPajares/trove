import { describe, expect, it } from 'vitest';

import { resolvePrimaryActionSlot, type PrimaryAction } from '@/lib/shell/primary-action';

const noop = () => undefined;
const addPlace: PrimaryAction = { label: 'Add place', onTrigger: noop };
const addItem: PrimaryAction = { label: 'Add item', onTrigger: noop };

describe('resolvePrimaryActionSlot', () => {
  it('takes the action of a screen that claims the button', () => {
    const saved = Symbol('saved');

    expect(resolvePrimaryActionSlot(null, saved, addPlace)).toEqual({
      action: addPlace,
      owner: saved,
    });
  });

  it('hands the button to whichever screen claimed it last', () => {
    const saved = Symbol('saved');
    const itinerary = Symbol('itinerary');
    const claimed = resolvePrimaryActionSlot(null, saved, addPlace);

    expect(resolvePrimaryActionSlot(claimed, itinerary, addItem)).toEqual({
      action: addItem,
      owner: itinerary,
    });
  });

  it('releases the button when the screen holding it leaves', () => {
    const saved = Symbol('saved');
    const claimed = resolvePrimaryActionSlot(null, saved, addPlace);

    expect(resolvePrimaryActionSlot(claimed, saved, null)).toBeNull();
  });

  /**
   * A route change mounts the arriving screen before the leaving one is gone,
   * so the leaving screen's release arrives after the new claim. Honouring it
   * would hand the button back to its global default on a screen that had just
   * asked for it — the itinerary would silently offer to create another trip.
   */
  it('ignores a release from a screen that no longer holds the button', () => {
    const saved = Symbol('saved');
    const itinerary = Symbol('itinerary');
    const claimed = resolvePrimaryActionSlot(null, saved, addPlace);
    const handedOver = resolvePrimaryActionSlot(claimed, itinerary, addItem);

    expect(resolvePrimaryActionSlot(handedOver, saved, null)).toBe(handedOver);
  });

  it('leaves an empty slot empty when an unknown screen releases', () => {
    expect(resolvePrimaryActionSlot(null, Symbol('saved'), null)).toBeNull();
  });
});
