import { getTranslations } from 'next-intl/server';

import { journalSerif } from '@/components/memories/journal-font';
import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { ToolsBackLink } from '@/components/tools/tools-back-link';

/** The shell `TaskTemplatesManager` renders, with only the templates waiting. */
export default async function TaskTemplatesLoading() {
  const t = await getTranslations('taskTemplates');

  return (
    <div className={journalSerif.variable}>
      <section className="mx-auto w-full max-w-5xl space-y-7">
        <div>
          <ToolsBackLink label={t('back')} />
          <PageHeader
            description={t('description')}
            eyebrow={t('eyebrow')}
            title={t('title')}
            titleFont="journal"
          />
        </div>
        <PageState headingLevel={2} kind="loading" loadingShape="list" title={t('loading')} />
      </section>
    </div>
  );
}
