import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';

import { cn } from '@/lib/utils';

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

/**
 * The control that opens a panel. It is a real button with the expanded state
 * and the panel's identity wired up by the primitive, so a caller only writes
 * the label and, where it wants one, a chevron keyed off `data-panel-open`.
 */
function CollapsibleTrigger({ className, ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] text-sm font-medium text-muted-foreground outline-none transition-colors duration-[var(--motion-standard)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      data-slot="collapsible-trigger"
      {...props}
    />
  );
}

/**
 * The disclosed content.
 *
 * The height animation runs on the primitive's measured
 * `--collapsible-panel-height` rather than on a magic number, so a panel whose
 * contents change size stays honest. This is a CSS transition rather than a
 * `motion/react` one, which the app-wide `MotionConfig reducedMotion="user"`
 * does not govern - hence the explicit `motion-reduce` variant here, once, so
 * every caller inherits it.
 *
 * Children are deliberately left unmounted while closed (the primitive's
 * default): a closed panel that still renders a long select is a cost the
 * traveller pays for something they cannot see.
 */
function CollapsiblePanel({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      className={cn(
        'h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-[var(--motion-standard)] ease-[var(--ease-standard)] data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none',
        className,
      )}
      data-slot="collapsible-panel"
      {...props}
    />
  );
}

export { Collapsible, CollapsiblePanel, CollapsibleTrigger };
