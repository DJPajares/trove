import { useRef, type PointerEvent, type RefObject } from 'react';

/**
 * Lets a mouse drag a horizontally scrolling strip the way a finger swipes it.
 *
 * Touch scrolls natively, so only mouse pointers are handled. Snapping is off
 * while dragging, or it fights every frame, and a drag that moved never counts
 * as a click on whatever it ended over - including a link around the strip.
 */
export function useDragScroll<T extends HTMLElement>(ref: RefObject<T | null>) {
  const drag = useRef<{ left: number; moved: boolean; x: number } | null>(null);

  return {
    onClickCapture(event: { preventDefault: () => void; stopPropagation: () => void }) {
      if (!drag.current?.moved) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onPointerCancel: end,
    onPointerDown(event: PointerEvent<T>) {
      const element = ref.current;
      if (!element || event.pointerType !== 'mouse' || event.button !== 0) return;
      drag.current = { left: element.scrollLeft, moved: false, x: event.clientX };
    },
    onPointerMove(event: PointerEvent<T>) {
      const element = ref.current;
      const state = drag.current;
      if (!element || !state) return;
      const distance = event.clientX - state.x;
      if (!state.moved && Math.abs(distance) < 4) return;
      if (!state.moved) {
        state.moved = true;
        element.setPointerCapture(event.pointerId);
        element.style.scrollSnapType = 'none';
      }
      element.scrollLeft = state.left - distance;
    },
    onPointerUp: end,
  };

  function end() {
    if (ref.current) ref.current.style.scrollSnapType = '';
    // Cleared after the click this release may produce has been swallowed.
    window.setTimeout(() => {
      drag.current = null;
    }, 0);
  }
}
