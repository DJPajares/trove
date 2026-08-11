import * as React from 'react';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

const itemGroupVariants = cva(
  'group/item-group flex w-full flex-col has-data-[size=sm]:gap-2.5 has-data-[size=xs]:gap-2',
  {
    variants: {
      variant: {
        default: 'gap-4',
        list: 'gap-0 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-surface)] [&>[data-slot=item]+[data-slot=item]]:border-t',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function ItemGroup({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof itemGroupVariants>) {
  return (
    <div
      role="list"
      data-slot="item-group"
      data-variant={variant}
      className={cn(itemGroupVariants({ variant, className }))}
      {...props}
    />
  );
}

function ItemSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="item-separator"
      orientation="horizontal"
      className={cn('my-2', className)}
      {...props}
    />
  );
}

const itemVariants = cva(
  'group/item flex min-h-12 w-full flex-wrap items-center rounded-[var(--radius-md)] border text-sm transition-[color,background-color,border-color,box-shadow] duration-[var(--motion-standard)] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 in-data-[variant=list]:rounded-none in-data-[variant=list]:border-0 [a]:hover:bg-surface-hover [button]:hover:bg-surface-hover',
  {
    variants: {
      variant: {
        default: 'border-transparent',
        outline: 'border-border',
        muted: 'border-transparent bg-muted/50',
      },
      size: {
        default: 'gap-3 px-3 py-3',
        sm: 'min-h-10 gap-2.5 px-3 py-2',
        xs: 'min-h-8 gap-2 px-2.5 py-1.5 in-data-[slot=dropdown-menu-content]:p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Item({
  className,
  variant = 'default',
  size = 'default',
  render,
  ...props
}: useRender.ComponentProps<'div'> & VariantProps<typeof itemVariants>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(itemVariants({ variant, size, className })),
      },
      props,
    ),
    render,
    state: {
      slot: 'item',
      variant,
      size,
    },
  });
}

const itemMediaVariants = cva(
  'flex shrink-0 items-center justify-center gap-2 group-has-data-[slot=item-description]/item:translate-y-0.5 group-has-data-[slot=item-description]/item:self-start [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        icon: "[&_svg:not([class*='size-'])]:size-4",
        image:
          'size-11 overflow-hidden rounded-[var(--radius-sm)] group-data-[size=sm]/item:size-9 group-data-[size=xs]/item:size-7 [&_img]:size-full [&_img]:object-cover',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function ItemMedia({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof itemMediaVariants>) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      className={cn(itemMediaVariants({ variant, className }))}
      {...props}
    />
  );
}

function ItemContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-content"
      className={cn(
        'flex flex-1 flex-col gap-1 group-data-[size=xs]/item:gap-0 [&+[data-slot=item-content]]:flex-none',
        className,
      )}
      {...props}
    />
  );
}

function ItemTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-title"
      className={cn(
        'line-clamp-1 flex w-fit items-center gap-2 text-sm leading-snug font-medium underline-offset-4',
        className,
      )}
      {...props}
    />
  );
}

function ItemDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        'line-clamp-2 text-left text-sm leading-normal font-normal text-muted-foreground group-data-[size=xs]/item:text-xs [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
        className,
      )}
      {...props}
    />
  );
}

function ItemActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="item-actions" className={cn('flex items-center gap-2', className)} {...props} />
  );
}

function ItemHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-header"
      className={cn('flex basis-full items-center justify-between gap-2', className)}
      {...props}
    />
  );
}

function ItemFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-footer"
      className={cn('flex basis-full items-center justify-between gap-2', className)}
      {...props}
    />
  );
}

export {
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ItemDescription,
  ItemHeader,
  ItemFooter,
};
