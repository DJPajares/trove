import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

function Tabs({ ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />;
}

const tabsListVariants = cva('inline-flex items-center', {
  variants: {
    variant: {
      segmented: 'relative gap-1 rounded-[var(--radius-md)] bg-muted/30 p-1',
      underline: 'relative gap-4 border-b border-border',
    },
  },
  defaultVariants: { variant: 'segmented' },
});

function TabsList({
  className,
  variant = 'segmented',
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant, className }))}
      {...props}
    />
  );
}

const tabsTabVariants = cva(
  "relative z-10 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] text-sm font-medium whitespace-nowrap outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        segmented: 'px-3 py-1.5 text-muted-foreground data-[active]:text-foreground',
        underline: 'pb-3 text-muted-foreground data-[active]:text-foreground',
      },
      size: {
        default: '',
        sm: 'text-[0.8rem]',
      },
    },
    defaultVariants: { variant: 'segmented', size: 'default' },
  },
);

function TabsTab({
  className,
  variant = 'segmented',
  size = 'default',
  ...props
}: TabsPrimitive.Tab.Props & VariantProps<typeof tabsTabVariants>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(tabsTabVariants({ variant, size, className }))}
      {...props}
    />
  );
}

const tabsIndicatorVariants = cva(
  'absolute z-0 transition-[left,top,width,height] duration-[var(--motion-standard)] ease-[var(--ease-standard)]',
  {
    variants: {
      variant: {
        segmented:
          'top-[var(--active-tab-top)] left-[var(--active-tab-left)] h-[var(--active-tab-height)] w-[var(--active-tab-width)] rounded-[var(--radius-sm)] bg-secondary shadow-[var(--shadow-control)]',
        underline:
          'bottom-0 left-[var(--active-tab-left)] h-0.5 w-[var(--active-tab-width)] rounded-full bg-brand',
      },
    },
    defaultVariants: { variant: 'segmented' },
  },
);

function TabsIndicator({
  className,
  variant = 'segmented',
  ...props
}: TabsPrimitive.Indicator.Props & VariantProps<typeof tabsIndicatorVariants>) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn(tabsIndicatorVariants({ variant, className }))}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn('outline-none focus-visible:ring-3 focus-visible:ring-ring/40', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTab, TabsIndicator, TabsPanel };
