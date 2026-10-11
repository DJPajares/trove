'use client';

import { Slider as SliderPrimitive } from '@base-ui/react/slider';

import { cn } from '@/lib/utils';

type SliderProps = SliderPrimitive.Root.Props & {
  /** The thumb carries the name when no visible `Slider.Label` is rendered. */
  thumbLabel?: string;
  /** Or names it after a visible label elsewhere on the page. */
  thumbLabelledBy?: string;
  getAriaValueText?: SliderPrimitive.Thumb.Props['getAriaValueText'];
};

/** A single-thumb slider. The control is padded to a 44px touch target. */
function Slider({
  className,
  getAriaValueText,
  thumbLabel,
  thumbLabelledBy,
  ...props
}: SliderProps) {
  return (
    <SliderPrimitive.Root className={cn('w-full', className)} data-slot="slider" {...props}>
      <SliderPrimitive.Control className="flex min-h-11 w-full touch-none items-center select-none data-disabled:opacity-50">
        <SliderPrimitive.Track className="h-2.5 w-full rounded-full bg-card ring-1 ring-border ring-inset select-none">
          <SliderPrimitive.Indicator className="rounded-full bg-primary select-none" />
          <SliderPrimitive.Thumb
            aria-label={thumbLabel}
            aria-labelledby={thumbLabelledBy}
            className="size-6 rounded-full border-[3px] border-card bg-primary shadow-[var(--shadow-control)] outline-none select-none has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
            getAriaValueText={getAriaValueText}
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
