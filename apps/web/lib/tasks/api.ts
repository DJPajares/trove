import {
  canUseSupportingOfflineFallback,
  queueSupportingMutation,
  readPreparedSupportingData,
} from '@/lib/offline/supporting-sync';
import {
  saveSupportingSnapshot,
  setOfflineApiReachable,
  type OfflineMutationOperation,
} from '@/lib/offline/trip-store';
import { getOfflineAuthContext } from '@/lib/offline/trip-sync';

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
    items: Array<{
      id: string;
      itineraryDayId: string | null;
      label: string;
      localStartTime?: string | null;
    }>;
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

async function getAuthContext() {
  try {
    return await getOfflineAuthContext();
  } catch {
    throw new TasksApiError('not_authenticated', 401);
  }
}

async function tasksRequest<T>(
  path: string,
  init: RequestInit | undefined,
  auth: Awaited<ReturnType<typeof getAuthContext>>,
) {
  if (!auth.accessToken) throw new TasksApiError('offline_session', 503);
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        // A JSON content type with no body makes Fastify reject the request, so this
        // is declared only when the request actually carries one.
        ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init?.headers,
      },
    });
  } catch {
    setOfflineApiReachable(false);
    throw new TasksApiError('tasks_unavailable', 503);
  }
  setOfflineApiReachable(response.status < 500);
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
  return fetchTasksWithOffline(tripId);
}

async function fetchTasksWithOffline(tripId: string) {
  const auth = await getAuthContext();
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return readPreparedSupportingData(auth.userId, tripId, 'tasks');
  }
  try {
    const data = await tasksRequest<TasksResponse>(`/trips/${tripId}/tasks`, undefined, auth);
    await saveSupportingSnapshot(auth.userId, tripId, 'tasks', data);
    return data;
  } catch (error) {
    if (canUseSupportingOfflineFallback(error)) {
      return readPreparedSupportingData(auth.userId, tripId, 'tasks');
    }
    throw error;
  }
}

export async function createTask(
  tripId: string,
  input: Required<Pick<TaskInput, 'context' | 'label'>> & TaskInput,
) {
  const auth = await getAuthContext();
  const operation: OfflineMutationOperation = {
    clientTaskId: crypto.randomUUID(),
    input,
    kind: 'task_create',
  };
  try {
    const result = await tasksRequest<{ task: Task }>(
      `/trips/${tripId}/tasks`,
      { body: JSON.stringify({ ...input, clientTaskId: operation.clientTaskId }), method: 'POST' },
      auth,
    );
    const current = await readPreparedSupportingData(auth.userId, tripId, 'tasks').catch(
      () => null,
    );
    if (current) {
      await saveSupportingSnapshot(auth.userId, tripId, 'tasks', {
        ...current,
        tasks: [result.task, ...current.tasks.filter((task) => task.id !== result.task.id)],
      });
    }
    return result;
  } catch (error) {
    if (!canUseSupportingOfflineFallback(error)) throw error;
    await queueSupportingMutation(auth.userId, tripId, operation);
    const data = await readPreparedSupportingData(auth.userId, tripId, 'tasks');
    const task = data.tasks.find((candidate) => candidate.id === operation.clientTaskId);
    if (!task) throw error;
    return { task };
  }
}

export async function updateTask(tripId: string, taskId: string, input: TaskInput) {
  const auth = await getAuthContext();
  const stored = await readPreparedSupportingData(auth.userId, tripId, 'tasks').catch(() => null);
  const baseTask = stored?.tasks.find((task) => task.id === taskId) ?? null;
  try {
    const result = await tasksRequest<{ task: Task }>(
      `/trips/${tripId}/tasks/${taskId}`,
      { body: JSON.stringify(input), method: 'PATCH' },
      auth,
    );
    if (stored) {
      await saveSupportingSnapshot(auth.userId, tripId, 'tasks', {
        ...stored,
        tasks: stored.tasks.map((task) => (task.id === taskId ? result.task : task)),
      });
    }
    return result;
  } catch (error) {
    if (!baseTask || !canUseSupportingOfflineFallback(error)) throw error;
    await queueSupportingMutation(auth.userId, tripId, {
      baseTask: structuredClone(baseTask),
      input,
      kind: 'task_update',
      taskId,
    });
    const data = await readPreparedSupportingData(auth.userId, tripId, 'tasks');
    const task = data.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw error;
    return { task };
  }
}

export async function deleteTask(tripId: string, taskId: string) {
  const auth = await getAuthContext();
  const stored = await readPreparedSupportingData(auth.userId, tripId, 'tasks').catch(() => null);
  const baseTask = stored?.tasks.find((task) => task.id === taskId) ?? null;
  try {
    const result = await tasksRequest<void>(
      `/trips/${tripId}/tasks/${taskId}`,
      { method: 'DELETE' },
      auth,
    );
    if (stored) {
      await saveSupportingSnapshot(auth.userId, tripId, 'tasks', {
        ...stored,
        tasks: stored.tasks.filter((task) => task.id !== taskId),
      });
    }
    return result;
  } catch (error) {
    if (!baseTask || !canUseSupportingOfflineFallback(error)) throw error;
    await queueSupportingMutation(auth.userId, tripId, {
      baseTask: structuredClone(baseTask),
      kind: 'task_delete',
      taskId,
    });
  }
}

export function fetchTaskTemplates() {
  return getAuthContext().then((auth) =>
    tasksRequest<{ templates: TaskTemplate[] }>('/task-templates', undefined, auth),
  );
}

export function createTaskTemplate(input: TaskTemplateInput) {
  return getAuthContext().then((auth) =>
    tasksRequest<{ template: TaskTemplate }>(
      '/task-templates',
      { body: JSON.stringify(input), method: 'POST' },
      auth,
    ),
  );
}

export function updateTaskTemplate(templateId: string, input: TaskTemplateInput) {
  return getAuthContext().then((auth) =>
    tasksRequest<{ template: TaskTemplate }>(
      `/task-templates/${templateId}`,
      { body: JSON.stringify(input), method: 'PATCH' },
      auth,
    ),
  );
}

export function deleteTaskTemplate(templateId: string) {
  return getAuthContext().then((auth) =>
    tasksRequest<void>(`/task-templates/${templateId}`, { method: 'DELETE' }, auth),
  );
}

export function applyTaskTemplate(templateId: string, tripId: string) {
  return getAuthContext().then((auth) =>
    tasksRequest<{ createdCount: number }>(
      `/task-templates/${templateId}/apply`,
      { body: JSON.stringify({ tripId }), method: 'POST' },
      auth,
    ),
  );
}
