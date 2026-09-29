/**
 * Where a summary panel (Plan Score, Insights) sits. A `card` stands on the
 * page next to other cards and shares their radius and border; an `inset` is
 * a section of a card that is already there, so it never nests a second one.
 */
export type PanelSurface = 'card' | 'inset';

export function panelSurfaceClass(surface: PanelSurface) {
  return surface === 'inset'
    ? 'border-t border-border-subtle pt-5'
    : 'rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4 sm:p-5';
}
