'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Pencil, Plane, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import {
  ApplyTemplateSheet,
  type AppliedTemplate,
} from '@/components/task-templates/apply-template-sheet';
import {
  TemplateEditorSheet,
  type TemplateDraft,
} from '@/components/task-templates/template-editor-sheet';
import { ToolsBackLink } from '@/components/tools/tools-back-link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  createTaskTemplate,
  deleteTaskTemplate,
  fetchTaskTemplates,
  type TaskTemplate,
  type TaskTemplateInput,
  updateTaskTemplate,
} from '@/lib/tasks/api';
import { fetchTrips, type Trip } from '@/lib/trips/api';
import { queryKeys } from '@/lib/query/keys';

type Starter = { items: string[]; name: string };

const EMPTY_TEMPLATES: TaskTemplate[] = [];
const EMPTY_TRIPS: Trip[] = [];
const PREVIEW_TASKS = 3;

function isStarterList(value: unknown): value is Starter[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof (entry as Starter).name === 'string' &&
        Array.isArray((entry as Starter).items),
    )
  );
}

/**
 * Task templates as a small checklist workspace. A first visit explains reuse
 * in three steps and offers starters that open in the editor, so nothing is
 * created behind the traveller's back. After that each template is a card that
 * reads like the list it is, with one way to edit it and one way to add it to
 * a trip. Templates stay lists: dates, owners and progress live on the trip.
 */
export function TaskTemplatesManager() {
  const t = useTranslations('taskTemplates');
  const queryClient = useQueryClient();
  const templatesQuery = useQuery({
    queryFn: fetchTaskTemplates,
    queryKey: queryKeys.taskTemplates(),
  });
  // The trip list is shared with the Trips library, so opening this screen
  // after visiting that one costs nothing.
  const tripsQuery = useQuery({ queryFn: () => fetchTrips(), queryKey: queryKeys.trips() });
  const templates = templatesQuery.data?.templates ?? EMPTY_TEMPLATES;
  const trips = tripsQuery.data?.trips ?? EMPTY_TRIPS;
  const status =
    templatesQuery.isPending || tripsQuery.isPending
      ? 'loading'
      : templatesQuery.error || tripsQuery.error
        ? 'error'
        : 'idle';
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<TaskTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState<TaskTemplate | null>(null);
  const [applied, setApplied] = useState<AppliedTemplate | null>(null);
  // The Tools shelf links here for one trip (`?trip=`), so adding a template
  // starts with that trip chosen. Read once on arrival.
  const [suggestedTripId, setSuggestedTripId] = useState('');
  useEffect(() => {
    setSuggestedTripId(new URLSearchParams(window.location.search).get('trip') ?? '');
  }, []);

  const rawStarters = t.raw('starters');
  const starters = useMemo(() => (isStarterList(rawStarters) ? rawStarters : []), [rawStarters]);
  // A starter the traveller already made (by name) is not offered again.
  const unusedStarters = starters.filter(
    (starter) =>
      !templates.some(
        (template) => template.name.trim().toLowerCase() === starter.name.toLowerCase(),
      ),
  );

  const refresh = useCallback(async () => {
    setError(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.trips() }),
    ]);
  }, [queryClient]);

  function openDraft(name: string, items: TemplateDraft['items'], template: TaskTemplate | null) {
    setEditing(template);
    setDraft({ items, key: Date.now(), name });
  }

  const openBlank = () => openDraft('', [], null);
  const openStarter = (starter: Starter) =>
    openDraft(
      starter.name,
      starter.items.map((label) => ({ label, note: null })),
      null,
    );
  const openEdit = (template: TaskTemplate) =>
    openDraft(
      template.name,
      template.items.map((item) => ({ label: item.label, note: item.note })),
      template,
    );

  async function handleSubmit(input: TaskTemplateInput) {
    if (editing) await updateTaskTemplate(editing.id, input);
    else await createTaskTemplate(input);
    await refresh();
    setDraft(null);
  }

  async function handleDelete() {
    if (!templateToDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteTaskTemplate(templateToDelete.id);
      setTemplateToDelete(null);
      setDraft(null);
      await refresh();
    } catch {
      setError(t('deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  const header = (
    <div>
      <ToolsBackLink label={t('back')} />
      <PageHeader
        actions={
          status === 'idle' && templates.length ? (
            <Button onClick={openBlank}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('newTemplate')}
            </Button>
          ) : undefined
        }
        description={t('description')}
        eyebrow={t('eyebrow')}
        title={t('title')}
        titleFont="journal"
      />
    </div>
  );

  if (status === 'loading') {
    return (
      <section className="mx-auto w-full max-w-5xl space-y-7">
        {header}
        <PageState headingLevel={2} kind="loading" loadingShape="list" title={t('loading')} />
      </section>
    );
  }
  if (status === 'error') {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        description={t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-7">
      {header}

      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {applied ? (
        <div
          className="flex items-center gap-3 rounded-[var(--radius-xl)] bg-score-media-background py-2 pr-2 pl-4 text-score-media-foreground"
          role="status"
        >
          <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-score-media-brand" />
          <p className="min-w-0 flex-1 text-sm">
            {t('applied', { count: applied.count, trip: applied.trip.name })}
          </p>
          <Link
            className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-score-media-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-score-media-foreground/50"
            href={`/trips/${applied.trip.id}/tasks`}
          >
            {t('openTasks')}
          </Link>
          <Button
            aria-label={t('dismiss')}
            className="shrink-0 text-score-media-muted hover:bg-score-media-foreground/10 hover:text-score-media-foreground"
            onClick={() => setApplied(null)}
            size="icon"
            variant="ghost"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {templates.length ? (
        <>
          <p className="-mt-3 text-sm text-muted-foreground">
            {t('summary', { count: templates.length })}
          </p>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
            {templates.map((template) => (
              <li key={template.id}>
                <TemplateCard
                  onAdd={() => {
                    setApplied(null);
                    setApplyingTemplate(template);
                  }}
                  onEdit={() => openEdit(template)}
                  template={template}
                />
              </li>
            ))}
          </ul>
          {unusedStarters.length ? (
            <StarterGrid
              compact
              onUse={openStarter}
              starters={unusedStarters}
              title={t('moreStarters')}
            />
          ) : null}
        </>
      ) : (
        <div className="space-y-6">
          <ol
            aria-label={t('howItWorks.label')}
            className="grid grid-cols-3 gap-1 rounded-[var(--radius-xl)] bg-score-media-background px-1.5 py-4 text-score-media-foreground sm:px-3"
          >
            {(['write', 'add', 'copy'] as const).map((step, index) => (
              <li
                className="flex flex-col gap-2 px-2 sm:flex-row sm:items-center sm:gap-3"
                key={step}
              >
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-score-media-foreground/10 text-sm font-bold text-score-media-brand"
                >
                  {index + 1}
                </span>
                <span className="text-[0.8125rem] leading-snug sm:text-sm">
                  {t(`howItWorks.${step}`)}
                </span>
              </li>
            ))}
          </ol>
          {starters.length ? (
            <StarterGrid onUse={openStarter} starters={starters} title={t('startersTitle')} />
          ) : null}
          <Button
            className="h-12 w-full rounded-full sm:w-auto sm:px-6"
            onClick={openBlank}
            variant="outline"
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('startBlank')}
          </Button>
        </div>
      )}

      <TemplateEditorSheet
        draft={draft}
        editing={Boolean(editing)}
        onClose={() => setDraft(null)}
        onDelete={editing ? () => setTemplateToDelete(editing) : undefined}
        onSubmit={handleSubmit}
      />

      <ApplyTemplateSheet
        onApplied={(result) => {
          setApplyingTemplate(null);
          setApplied(result);
        }}
        onClose={() => setApplyingTemplate(null)}
        suggestedTripId={suggestedTripId}
        template={applyingTemplate}
        trips={trips}
      />

      <AlertDialog
        onOpenChange={(open) => !open && setTemplateToDelete(null)}
        open={Boolean(templateToDelete)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', { name: templateToDelete?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void handleDelete()}
              variant="destructive"
            >
              {deleting ? t('deleting') : t('deleteTemplate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** A template that reads like the list it is: name, size, its first few tasks. */
function TemplateCard({
  onAdd,
  onEdit,
  template,
}: Readonly<{ onAdd: () => void; onEdit: () => void; template: TaskTemplate }>) {
  const t = useTranslations('taskTemplates');
  const rest = template.items.length - PREVIEW_TASKS;

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card shadow-[var(--shadow-surface)]">
      <button
        aria-label={t('editTemplate', { name: template.name })}
        className="group flex w-full items-start gap-3 px-4 pt-4 pb-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset sm:px-5"
        onClick={onEdit}
        type="button"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-journal text-[1.625rem] leading-none text-balance [overflow-wrap:anywhere]">
            {template.name}
          </span>
          <span className="mt-1.5 block text-sm text-muted-foreground">
            {t('taskCount', { count: template.items.length })}
          </span>
        </span>
        <Pencil
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors duration-[var(--motion-standard)] group-hover:text-foreground"
        />
      </button>
      <ul className="flex-1 space-y-1.5 px-4 pt-2 text-sm sm:px-5">
        {template.items.slice(0, PREVIEW_TASKS).map((item) => (
          <li className="flex items-center gap-2.5" key={item.id}>
            <span
              aria-hidden="true"
              className="size-3.5 shrink-0 rounded-full border-[1.5px] border-secondary-foreground/40"
            />
            <span className="min-w-0 truncate">{item.label}</span>
          </li>
        ))}
        {rest > 0 ? (
          <li className="pl-6 text-[0.8125rem] text-muted-foreground">
            {t('moreTasks', { count: rest })}
          </li>
        ) : null}
      </ul>
      <div className="p-3">
        <Button
          aria-label={t('addNamedToTrip', { name: template.name })}
          className="h-11 w-full rounded-[var(--radius-lg)]"
          onClick={onAdd}
          variant="secondary"
        >
          <Plane aria-hidden="true" data-icon="inline-start" />
          {t('addToTrip')}
        </Button>
      </div>
    </article>
  );
}

function StarterGrid({
  compact = false,
  onUse,
  starters,
  title,
}: Readonly<{
  compact?: boolean;
  onUse: (starter: Starter) => void;
  starters: readonly Starter[];
  title: string;
}>) {
  const t = useTranslations('taskTemplates');

  return (
    <section aria-label={title} className="space-y-2.5">
      <h2 className="px-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {title}
      </h2>
      <ul className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {starters.map((starter) => (
          <li key={starter.name}>
            <button
              aria-label={t('useStarter', { name: starter.name })}
              className={
                compact
                  ? 'flex h-full w-full flex-col items-start gap-1 rounded-[var(--radius-lg)] border border-dashed border-border-strong px-3.5 py-3 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40'
                  : 'flex h-full min-h-36 w-full flex-col items-start gap-2 rounded-[var(--radius-lg)] border border-border-subtle bg-card p-3.5 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40'
              }
              onClick={() => onUse(starter)}
              type="button"
            >
              <span className="font-journal text-[1.375rem] leading-[1.05]">{starter.name}</span>
              {compact ? null : (
                <span className="w-full min-w-0 text-[0.8125rem] leading-5 text-muted-foreground">
                  {starter.items.slice(0, PREVIEW_TASKS).map((item) => (
                    <span className="block truncate" key={item}>
                      {item}
                    </span>
                  ))}
                </span>
              )}
              <span className="mt-auto pt-1 text-xs font-semibold text-brand">
                {t('taskCount', { count: starter.items.length })}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {compact ? null : <p className="px-1 text-xs text-muted-foreground">{t('startersHint')}</p>}
    </section>
  );
}
