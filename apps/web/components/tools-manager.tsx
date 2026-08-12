import { CurrencyConverter } from '@/components/currency-converter';
import { PageHeader } from '@/components/page-header';
import { TaskTemplatesManager } from '@/components/task-templates-manager';
import { Separator } from '@/components/ui/separator';
import { getTranslations } from 'next-intl/server';

export async function ToolsManager() {
  const t = await getTranslations('tools');

  return (
    <section className="mx-auto w-full max-w-5xl space-y-8">
      <PageHeader description={t('description')} title={t('title')} />
      <CurrencyConverter />
      <Separator />
      <TaskTemplatesManager embedded />
    </section>
  );
}
