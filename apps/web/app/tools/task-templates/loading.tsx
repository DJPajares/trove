import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { Button } from '@/components/ui/button';

/** The shell `TaskTemplatesManager` renders, with only the templates waiting. */
export default async function TaskTemplatesLoading() {
  const t = await getTranslations('taskTemplates');

  return (
    <section className="mx-auto w-full max-w-5xl space-y-7">
      <PageHeader
        actions={
          <Button disabled type="button">
            {t('newTemplate')}
          </Button>
        }
        description={t('description')}
        title={t('title')}
      />
      <PageState headingLevel={2} kind="loading" loadingShape="list" title={t('loading')} />
    </section>
  );
}
