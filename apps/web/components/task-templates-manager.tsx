'use client';

import { CircleAlert, ClipboardCheck, CopyPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  applyTaskTemplate,
  createTaskTemplate,
  deleteTaskTemplate,
  fetchTaskTemplates,
  type TaskTemplate,
  updateTaskTemplate,
} from '@/lib/tasks/api';
import { fetchTrips, type Trip } from '@/lib/trips/api';

type EditorState =
  | { mode: 'closed'; template: null }
  | { mode: 'create'; template: null }
  | { mode: 'edit'; template: TaskTemplate };
type TemplateForm = { items: string[]; name: string };

function createForm(template: TaskTemplate | null): TemplateForm {
  return {
    items: template?.items.map((item) => item.label) ?? [''],
    name: template?.name ?? '',
  };
}

export function TaskTemplatesManager() {
  const t = useTranslations('taskTemplates');
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed', template: null });
  const [form, setForm] = useState<TemplateForm>(() => createForm(null));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<TaskTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState<TaskTemplate | null>(null);
  const [selectedTripId, setSelectedTripId] = useState('');
  const [applying, setApplying] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [templateResult, tripResult] = await Promise.all([fetchTaskTemplates(), fetchTrips()]);
      setTemplates(templateResult.templates);
      setTrips(tripResult.trips);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openCreate() {
    setForm(createForm(null));
    setFormError(null);
    setEditor({ mode: 'create', template: null });
  }

  function openEdit(template: TaskTemplate) {
    setForm(createForm(template));
    setFormError(null);
    setEditor({ mode: 'edit', template });
  }

  function closeEditor() {
    setEditor({ mode: 'closed', template: null });
    setFormError(null);
  }

  function updateItem(index: number, value: string) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? value : item)),
    }));
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    const items = form.items.map((label) => label.trim()).filter(Boolean);
    if (!name || !items.length || items.length !== form.items.length) {
      setFormError(t('requiredError'));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const input = { items: items.map((label) => ({ label })), name };
      if (editor.mode === 'create') {
        await createTaskTemplate(input);
      } else if (editor.mode === 'edit') {
        await updateTaskTemplate(editor.template.id, input);
      }
      await refresh();
      closeEditor();
    } catch {
      setFormError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!templateToDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteTaskTemplate(templateToDelete.id);
      setTemplateToDelete(null);
      closeEditor();
      await refresh();
    } catch {
      setError(t('deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  async function handleApply() {
    if (!applyingTemplate || !selectedTripId) return;
    setApplying(true);
    setError(null);
    try {
      await applyTaskTemplate(applyingTemplate.id, selectedTripId);
      setApplyingTemplate(null);
      setSelectedTripId('');
    } catch {
      setError(t('applyError'));
    } finally {
      setApplying(false);
    }
  }

  if (status === 'loading') {
    return (
      <PageState
        className="mx-auto max-w-5xl"
        kind="loading"
        loadingShape="list"
        title={t('loading')}
      />
    );
  }
  if (status === 'error') {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        className="mx-auto max-w-5xl"
        description={t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-7">
      <PageHeader
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('newTemplate')}
          </Button>
        }
        description={t('description')}
        title={t('title')}
      />

      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {templates.length ? (
        <ItemGroup aria-label={t('title')} variant="list">
          {templates.map((template) => (
            <Item className="min-h-20 flex-nowrap px-3 py-3" key={template.id} variant="default">
              <ItemMedia
                className="size-10 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
                variant="icon"
              >
                <ClipboardCheck aria-hidden="true" />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>{template.name}</ItemTitle>
                <ItemDescription>
                  {t('taskCount', { count: template.items.length })}:{' '}
                  {template.items.map((item) => item.label).join(', ')}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  aria-label={t('applyTemplate', { name: template.name })}
                  onClick={() => {
                    setSelectedTripId('');
                    setApplyingTemplate(template);
                  }}
                  size="sm"
                  variant="outline"
                >
                  <CopyPlus aria-hidden="true" data-icon="inline-start" />
                  {t('apply')}
                </Button>
                <Button
                  aria-label={t('editTemplate', { name: template.name })}
                  onClick={() => openEdit(template)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Pencil aria-hidden="true" />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <PageState
          actions={
            <Button onClick={openCreate} variant="outline">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('createFirst')}
            </Button>
          }
          className="min-h-64 justify-center"
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<ClipboardCheck aria-hidden="true" />}
          kind="empty"
          title={t('emptyTitle')}
        />
      )}

      <Sheet onOpenChange={(open) => !open && closeEditor()} open={editor.mode !== 'closed'}>
        <SheetContent
          className="w-full md:data-[side=right]:w-[min(38rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
        >
          <SheetHeader className="border-b">
            <SheetTitle>{editor.mode === 'edit' ? t('editTitle') : t('createTitle')}</SheetTitle>
            <SheetDescription>{t('editorDescription')}</SheetDescription>
          </SheetHeader>
          {editor.mode !== 'closed' ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <FieldGroup>
                  {formError ? (
                    <Alert role="alert" variant="destructive">
                      <CircleAlert aria-hidden="true" />
                      <AlertDescription>{formError}</AlertDescription>
                    </Alert>
                  ) : null}
                  <Field>
                    <FieldLabel htmlFor="task-template-name">{t('name')}</FieldLabel>
                    <Input
                      id="task-template-name"
                      maxLength={100}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder={t('namePlaceholder')}
                      required
                      value={form.name}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>{t('templateTasks')}</FieldLabel>
                    <div className="space-y-2">
                      {form.items.map((item, index) => (
                        <div className="flex items-center gap-2" key={index}>
                          <Input
                            aria-label={t('taskLabel', { number: index + 1 })}
                            maxLength={200}
                            onChange={(event) => updateItem(index, event.target.value)}
                            placeholder={t('taskPlaceholder')}
                            required
                            value={item}
                          />
                          <Button
                            aria-label={t('removeTask', { number: index + 1 })}
                            disabled={form.items.length === 1}
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                items: current.items.filter((_, itemIndex) => itemIndex !== index),
                              }))
                            }
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button
                      className="mt-2"
                      disabled={form.items.length >= 20}
                      onClick={() =>
                        setForm((current) => ({ ...current, items: [...current.items, ''] }))
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Plus aria-hidden="true" data-icon="inline-start" />
                      {t('addTemplateTask')}
                    </Button>
                  </Field>
                </FieldGroup>
              </div>
              <SheetFooter className="sm:flex-row sm:items-center sm:justify-between">
                {editor.mode === 'edit' ? (
                  <Button
                    onClick={() => setTemplateToDelete(editor.template)}
                    type="button"
                    variant="destructive"
                  >
                    <Trash2 aria-hidden="true" data-icon="inline-start" />
                    {t('deleteTemplate')}
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button disabled={saving} onClick={closeEditor} type="button" variant="outline">
                    {t('cancel')}
                  </Button>
                  <Button disabled={saving} type="submit">
                    {saving ? t('saving') : t('save')}
                  </Button>
                </div>
              </SheetFooter>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet
        onOpenChange={(open) => !open && setApplyingTemplate(null)}
        open={Boolean(applyingTemplate)}
      >
        <SheetContent
          className="w-full md:data-[side=right]:w-[min(30rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
        >
          <SheetHeader className="border-b">
            <SheetTitle>{t('applyTitle')}</SheetTitle>
            <SheetDescription>
              {t('applyDescription', { name: applyingTemplate?.name ?? '' })}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col p-5">
            <Field>
              <FieldLabel htmlFor="template-trip">{t('chooseTrip')}</FieldLabel>
              <Select
                onValueChange={(value) => setSelectedTripId(value ?? '')}
                value={selectedTripId}
              >
                <SelectTrigger className="w-full" id="template-trip">
                  <SelectValue>{t('chooseTrip')}</SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  {trips.map((trip) => (
                    <SelectItem key={trip.id} value={trip.id}>
                      {trip.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="mt-auto flex flex-col-reverse gap-2 pt-5 sm:flex-row sm:justify-end">
              <Button
                disabled={applying}
                onClick={() => setApplyingTemplate(null)}
                variant="outline"
              >
                {t('cancel')}
              </Button>
              <Button disabled={applying || !selectedTripId} onClick={() => void handleApply()}>
                {applying ? t('applying') : t('apply')}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
