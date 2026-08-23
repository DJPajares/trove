import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-full font-medium whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        brand: 'bg-brand/10 text-brand',
        success: 'bg-status-success/10 text-status-success',
        warning: 'bg-status-warning/10 text-status-warning',
        muted: 'bg-muted text-muted-foreground',
        solid: 'bg-primary text-primary-foreground',
      },
      size: {
        default: "px-2 py-0.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "px-1.5 py-0.5 text-[11px] [&_svg:not([class*='size-'])]:size-3",
        count: 'min-w-4 justify-center px-1 text-[10px] leading-4 font-semibold',
      },
    },
    defaultVariants: { variant: 'brand', size: 'default' },
  },
);

function Badge({
  className,
  variant = 'brand',
  size = 'default',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      { className: cn(badgeVariants({ variant, size, className })) },
      props,
    ),
    render,
    state: { slot: 'badge', variant, size },
  });
}

export { Badge, badgeVariants };
