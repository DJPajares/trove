import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export type TaskContext =
  | { kind: 'trip' }
  | { itineraryDayId: string; kind: 'day' }
  | { itineraryItemId: string; kind: 'item' };

export type Task = {
  completed: boolean;
  completedAt: string | null;
  context: TaskContext;
  createdAt: string;
  dueDate: string | null;
  dueLocalTime: string | null;
  dueTimeZone: string | null;
  id: string;
  label: string;
  note: string | null;
  updatedAt: string;
};

export type TaskInput = {
  completed?: boolean;
  context?: TaskContext;
  dueDate?: string | null;
  dueLocalTime?: string | null;
  label?: string;
  note?: string | null;
};

export type TaskTemplate = {
  createdAt: string;
  id: string;
  items: Array<{ id: string; label: string; note: string | null; position: number }>;
  name: string;
  updatedAt: string;
};

export type TaskTemplateInput = {
  items: Array<{ label: string; note?: string | null }>;
  name: string;
};

export type TasksResponse = {
  contexts: {
    days: Array<{ date: string; id: string }>;
    items: Array<{ id: string; itineraryDayId: string | null; label: string }>;
  };
  tasks: Task[];
  trip: { id: string; name: string };
};

export class TasksApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

async function getAccessToken() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new TasksApiError('supabase_not_configured', 500);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new TasksApiError('not_authenticated', 401);
  return data.session.access_token;
}

async function tasksRequest<T>(path: string, init?: RequestInit) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new TasksApiError(
      body.code ?? `tasks_request_failed_${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function fetchTasks(tripId: string) {
  return tasksRequest<TasksResponse>(`/trips/${tripId}/tasks`);
}

export function createTask(
  tripId: string,
  input: Required<Pick<TaskInput, 'context' | 'label'>> & TaskInput,
) {
  return tasksRequest<{ task: Task }>(`/trips/${tripId}/tasks`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateTask(tripId: string, taskId: string, input: TaskInput) {
  return tasksRequest<{ task: Task }>(`/trips/${tripId}/tasks/${taskId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function deleteTask(tripId: string, taskId: string) {
  return tasksRequest<void>(`/trips/${tripId}/tasks/${taskId}`, { method: 'DELETE' });
}

export function fetchTaskTemplates() {
  return tasksRequest<{ templates: TaskTemplate[] }>('/task-templates');
}

export function createTaskTemplate(input: TaskTemplateInput) {
  return tasksRequest<{ template: TaskTemplate }>('/task-templates', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateTaskTemplate(templateId: string, input: TaskTemplateInput) {
  return tasksRequest<{ template: TaskTemplate }>(`/task-templates/${templateId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function deleteTaskTemplate(templateId: string) {
  return tasksRequest<void>(`/task-templates/${templateId}`, { method: 'DELETE' });
}

export function applyTaskTemplate(templateId: string, tripId: string) {
  return tasksRequest<{ createdCount: number }>(`/task-templates/${templateId}/apply`, {
    body: JSON.stringify({ tripId }),
    method: 'POST',
  });
}
