/**
 * The mobile bar's current-page mark.
 *
 * Colour alone could not carry this: `text-brand` against `text-muted-foreground`
 * measures 1.20:1, so the active tab collapsed into its neighbours in greyscale and
 * for red-green colour vision deficiency. A shape is the second channel, which is
 * what WCAG 1.4.1 asks for.
 *
 * `-top-2` cancels the bar's `pt-2` so the mark sits flush on the top edge, the way
 * the desktop underline sits on its bottom edge. It stays narrower than the icon well
 * it marks because the create action's notch curves away +/-50.6px from the bar's
 * centre, and columns two and four sit close enough to that on a 320px screen that a
 * wider mark would overhang the curve.
 *
 * Shared rather than inlined because it has to appear identically here and in
 * `AppMenuTrigger`, which lives in another file.
 */
export function NavActiveIndicator() {
  return (
    <span
      aria-hidden="true"
      className="absolute -top-2 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-b-full bg-brand"
    />
  );
}
