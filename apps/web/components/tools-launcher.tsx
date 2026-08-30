import { ArrowLeftRight, ArrowUpRight, ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { toolNavigationDestinations } from '@/lib/navigation';

export function ToolsLauncher() {
  const tools = useTranslations('tools');
  const currency = useTranslations('currency');
  const taskTemplates = useTranslations('taskTemplates');
  const details = {
    currency: {
      description: currency('description'),
      icon: ArrowLeftRight,
      title: currency('title'),
      useCase: tools('currencyUseCase'),
    },
    taskTemplates: {
      description: taskTemplates('description'),
      icon: ClipboardCheck,
      title: taskTemplates('title'),
      useCase: tools('taskTemplatesUseCase'),
    },
  };

  return (
    <section className="mx-auto w-full max-w-5xl space-y-8">
      <PageHeader description={tools('description')} title={tools('title')} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {toolNavigationDestinations.map(({ href, key }, index) => {
          const { description, icon: Icon, title, useCase } = details[key];

          return (
            <Item
              className={
                index === 0
                  ? 'group min-h-56 items-stretch overflow-hidden rounded-[var(--radius-xl)] border-border-subtle bg-card p-0 shadow-[var(--shadow-surface)] hover:border-border-strong hover:bg-card'
                  : 'group min-h-56 items-stretch overflow-hidden rounded-[var(--radius-xl)] border-border-subtle bg-surface-tint p-0 shadow-none hover:border-border-strong hover:bg-surface-tint'
              }
              key={href}
              render={<Link href={href} />}
              variant="outline"
            >
              <div className="flex w-full flex-col justify-between gap-8 p-5 sm:p-6">
                <div className="space-y-5">
                  <ItemMedia
                    className="size-11 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
                    variant="icon"
                  >
                    <Icon aria-hidden="true" className="size-5" />
                  </ItemMedia>
                  <ItemContent className="gap-2">
                    <ItemTitle className="text-lg font-semibold text-foreground">{title}</ItemTitle>
                    <p className="max-w-[32ch] text-sm leading-5 font-medium text-foreground">
                      {useCase}
                    </p>
                    <ItemDescription className="line-clamp-none max-w-[42ch] leading-6">
                      {description}
                    </ItemDescription>
                  </ItemContent>
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-4">
                  <span className="text-sm font-semibold text-foreground">
                    {tools('openTool', { tool: title })}
                  </span>
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-[var(--motion-standard)] ease-[var(--ease-standard)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  >
                    <ArrowUpRight aria-hidden="true" className="size-4" />
                  </span>
                </div>
              </div>
            </Item>
          );
        })}
      </div>
    </section>
  );
}
