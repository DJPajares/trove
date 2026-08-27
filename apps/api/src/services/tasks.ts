import { getPrismaClient, type Prisma } from '@trove/db';

import { formatLocalTime, parseLocalTime, resolveTaskTimeZone } from './itinerary-rules.js';
import { formatDateOnly } from './trip-rules.js';

export type TaskContextInput =
  | { kind: 'trip' }
  | { itineraryDayId: string; kind: 'day' }
  | { itineraryItemId: string; kind: 'item' };

export type TaskInput = {
  completed?: boolean;
  context?: TaskContextInput;
  dueDate?: string | null;
  dueLocalTime?: string | null;
  label?: string;
  note?: string | null;
};

export type TaskTemplateInput = {
  items: Array<{ label: string; note?: string | null }>;
  name: string;
};

export class TaskNotFoundError extends Error {
  constructor(
    code:
      | 'itinerary_day_not_found'
      | 'itinerary_item_not_found'
      | 'task_not_found'
      | 'task_template_not_found'
      | 'trip_not_found',
  ) {
    super(code);
  }
}

export class TaskValidationError extends Error {
  constructor(public readonly code: 'invalid_due_date' | 'invalid_due_time' | 'invalid_task') {
    super(code);
  }
}

export class TaskConflictError extends Error {
  constructor() {
    super('task_conflict');
  }
}

const taskInclude = {
  itineraryDay: { select: { date: true } },
  itineraryItem: {
    select: {
      customLabel: true,
      customLocation: true,
      itineraryDayId: true,
    },
  },
} as const;

type TaskRecord = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

function parseDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDateOnly(date) !== value) {
    throw new TaskValidationError('invalid_due_date');
  }
  return date;
}

function normalizeLabel(value: string | undefined) {
  const label = value?.trim() ?? '';
  if (!label) throw new TaskValidationError('invalid_task');
  return label;
}

function serializeContext(task: TaskRecord) {
  if (task.itineraryItemId) {
    return { itineraryItemId: task.itineraryItemId, kind: 'item' as const };
  }
  if (task.itineraryDayId) {
    return { itineraryDayId: task.itineraryDayId, kind: 'day' as const };
  }
  return { kind: 'trip' as const };
}

function serializeTask(task: TaskRecord) {
  return {
    completed: Boolean(task.completedAt),
    completedAt: task.completedAt?.toISOString() ?? null,
    context: serializeContext(task),
    createdAt: task.createdAt.toISOString(),
    dueDate: task.dueDate ? formatDateOnly(task.dueDate) : null,
    dueLocalTime: formatLocalTime(task.dueLocalTime),
    dueTimeZone: task.dueTimeZone,
    id: task.id,
    label: task.label,
    note: task.note,
    updatedAt: task.updatedAt.toISOString(),
  };
}

function serializeTemplate(template: Prisma.TaskTemplateGetPayload<{ include: { items: true } }>) {
  return {
    createdAt: template.createdAt.toISOString(),
    id: template.id,
    items: template.items
      .toSorted((left, right) => left.position - right.position)
      .map((item) => ({
        id: item.id,
        label: item.label,
        note: item.note,
        position: item.position,
      })),
    name: template.name,
    updatedAt: template.updatedAt.toISOString(),
  };
}

async function findOwnedTrip(
  transaction: Prisma.TransactionClient,
  userId: string,
  tripId: string,
) {
  const trip = await transaction.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: { id: true, name: true, referenceTimeZone: true },
  });
  if (!trip) throw new TaskNotFoundError('trip_not_found');
  return trip;
}

async function resolveContext(
  transaction: Prisma.TransactionClient,
  tripId: string,
  tripTimeZone: string,
  context: TaskContextInput,
) {
  if (context.kind === 'trip') {
    return {
      data: { itineraryDayId: null, itineraryItemId: null },
      resolution: resolveTaskTimeZone({
        itineraryDayTimeZone: null,
        itineraryItemTimeZone: null,
        tripTimeZone,
      }),
    };
  }

  if (context.kind === 'day') {
    const day = await transaction.itineraryDay.findFirst({
      where: { id: context.itineraryDayId, tripId },
      select: { defaultTimeZone: true, id: true },
    });
    if (!day) throw new TaskNotFoundError('itinerary_day_not_found');
    return {
      data: { itineraryDayId: day.id, itineraryItemId: null },
      resolution: resolveTaskTimeZone({
        itineraryDayTimeZone: day.defaultTimeZone,
        itineraryItemTimeZone: null,
        tripTimeZone,
      }),
    };
  }

  const item = await transaction.itineraryItem.findFirst({
    where: { id: context.itineraryItemId, tripId },
    include: { itineraryDay: { select: { defaultTimeZone: true } } },
  });
  if (!item) throw new TaskNotFoundError('itinerary_item_not_found');
  return {
    data: { itineraryDayId: null, itineraryItemId: item.id },
    resolution: resolveTaskTimeZone({
      itineraryDayTimeZone: item.itineraryDay?.defaultTimeZone ?? null,
      itineraryItemTimeZone: item.timeZone,
      tripTimeZone,
    }),
  };
}

function taskContextFromRecord(task: {
  itineraryDayId: string | null;
  itineraryItemId: string | null;
}): TaskContextInput {
  if (task.itineraryItemId) return { itineraryItemId: task.itineraryItemId, kind: 'item' };
  if (task.itineraryDayId) return { itineraryDayId: task.itineraryDayId, kind: 'day' };
  return { kind: 'trip' };
}

function dueData(
  dueDate: string | null,
  dueLocalTime: string | null,
  resolution: ReturnType<typeof resolveTaskTimeZone>,
) {
  if (!dueDate) {
    if (dueLocalTime) throw new TaskValidationError('invalid_due_time');
    return {
      dueDate: null,
      dueLocalTime: null,
      dueTimeZone: null,
      dueTimeZoneResolvedAt: null,
      dueTimeZoneSource: null,
    };
  }

  let time: Date | null = null;
  if (dueLocalTime) {
    try {
      time = parseLocalTime(dueLocalTime);
    } catch {
      throw new TaskValidationError('invalid_due_time');
    }
  }
  return {
    dueDate: parseDateOnly(dueDate),
    dueLocalTime: time,
    dueTimeZone: resolution.timeZone,
    dueTimeZoneResolvedAt: new Date(),
    dueTimeZoneSource: resolution.source,
  };
}

export async function listTasks(userId: string, tripId: string) {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: {
      itineraryDays: { orderBy: { date: 'asc' }, select: { date: true, id: true } },
      itineraryItems: {
        orderBy: [{ itineraryDayId: 'asc' }, { position: 'asc' }],
        select: {
          customLabel: true,
          customLocation: true,
          id: true,
          itineraryDayId: true,
          localStartTime: true,
          tripPlace: {
            include: {
              place: {
                include: {
                  providerRefs: {
                    orderBy: { cachedAt: 'desc' },
                    select: { cachedName: true },
                  },
                },
              },
            },
          },
        },
      },
      tasks: {
        include: taskInclude,
        orderBy: [{ completedAt: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!trip) throw new TaskNotFoundError('trip_not_found');

  return {
    contexts: {
      days: trip.itineraryDays.map((day) => ({ date: formatDateOnly(day.date), id: day.id })),
      items: trip.itineraryItems.map((item) => ({
        id: item.id,
        itineraryDayId: item.itineraryDayId,
        localStartTime: formatLocalTime(item.localStartTime),
        label:
          item.customLabel ??
          item.customLocation ??
          item.tripPlace?.place.customName ??
          item.tripPlace?.place.providerRefs.find((reference) => reference.cachedName)
            ?.cachedName ??
          item.tripPlace?.place.providerLabel ??
          'Itinerary item',
      })),
    },
    tasks: trip.tasks.map(serializeTask),
    trip: { id: trip.id, name: trip.name },
  };
}

export async function createTask(
  userId: string,
  tripId: string,
  input: Required<Pick<TaskInput, 'context' | 'label'>> & TaskInput,
  clientTaskId?: string,
) {
  const prisma = getPrismaClient();
  const createdId = await prisma.$transaction(async (transaction) => {
    const trip = await findOwnedTrip(transaction, userId, tripId);
    if (clientTaskId) {
      const existing = await transaction.task.findFirst({
        where: { id: clientTaskId, tripId, trip: { ownerId: userId } },
        select: { id: true },
      });
      if (existing) return existing.id;
    }
    const context = await resolveContext(
      transaction,
      tripId,
      trip.referenceTimeZone,
      input.context,
    );
    return (
      await transaction.task.create({
        data: {
          ...context.data,
          ...dueData(input.dueDate ?? null, input.dueLocalTime ?? null, context.resolution),
          label: normalizeLabel(input.label),
          ...(clientTaskId ? { id: clientTaskId } : {}),
          note: input.note?.trim() || null,
          tripId,
        },
      })
    ).id;
  });
  const task = await prisma.task.findFirst({
    where: { id: createdId, trip: { ownerId: userId }, tripId },
    include: taskInclude,
  });
  if (!task) throw new TaskNotFoundError('task_not_found');
  return serializeTask(task);
}

export async function updateTask(
  userId: string,
  tripId: string,
  taskId: string,
  input: TaskInput,
  expectedUpdatedAt?: string,
) {
  const prisma = getPrismaClient();
  const updatedId = await prisma.$transaction(async (transaction) => {
    const trip = await findOwnedTrip(transaction, userId, tripId);
    const current = await transaction.task.findFirst({ where: { id: taskId, tripId } });
    if (!current) throw new TaskNotFoundError('task_not_found');
    if (expectedUpdatedAt && current.updatedAt.toISOString() !== expectedUpdatedAt) {
      throw new TaskConflictError();
    }

    const currentContext = taskContextFromRecord(current);
    const nextContext = input.context ?? currentContext;
    const contextChanged = contextValue(nextContext) !== contextValue(currentContext);
    const currentDueDate = current.dueDate ? formatDateOnly(current.dueDate) : null;
    const dueDate = input.dueDate === undefined ? currentDueDate : input.dueDate;
    const dueLocalTime =
      input.dueLocalTime === undefined ? formatLocalTime(current.dueLocalTime) : input.dueLocalTime;
    const dueDateChanged = dueDate !== currentDueDate;
    const dueLocalTimeChanged = dueLocalTime !== formatLocalTime(current.dueLocalTime);
    const shouldResolveDueTimeZone = contextChanged || dueDateChanged || dueLocalTimeChanged;
    const context = shouldResolveDueTimeZone
      ? await resolveContext(transaction, tripId, trip.referenceTimeZone, nextContext)
      : null;

    const updated = await transaction.task.updateMany({
      where: {
        id: current.id,
        ...(expectedUpdatedAt ? { updatedAt: current.updatedAt } : {}),
      },
      data: {
        ...context?.data,
        ...(input.label !== undefined ? { label: normalizeLabel(input.label) } : {}),
        ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
        ...(input.completed !== undefined
          ? { completedAt: input.completed ? new Date() : null }
          : {}),
        ...(shouldResolveDueTimeZone
          ? dueData(
              dueDate,
              dueLocalTime,
              context?.resolution ??
                resolveTaskTimeZone({
                  itineraryDayTimeZone: null,
                  itineraryItemTimeZone: null,
                  tripTimeZone: trip.referenceTimeZone,
                }),
            )
          : {}),
      },
    });
    if (!updated.count) throw new TaskConflictError();
    return current.id;
  });
  const task = await prisma.task.findFirst({
    where: { id: updatedId, trip: { ownerId: userId }, tripId },
    include: taskInclude,
  });
  if (!task) throw new TaskNotFoundError('task_not_found');
  return serializeTask(task);
}

function contextValue(context: TaskContextInput) {
  if (context.kind === 'day') return `day:${context.itineraryDayId}`;
  if (context.kind === 'item') return `item:${context.itineraryItemId}`;
  return 'trip';
}

export async function deleteTask(
  userId: string,
  tripId: string,
  taskId: string,
  expectedUpdatedAt?: string,
) {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const task = await transaction.task.findFirst({
      where: { id: taskId, tripId },
      select: { id: true, updatedAt: true },
    });
    if (!task) throw new TaskNotFoundError('task_not_found');
    if (expectedUpdatedAt && task.updatedAt.toISOString() !== expectedUpdatedAt) {
      throw new TaskConflictError();
    }
    const deleted = await transaction.task.deleteMany({
      where: {
        id: task.id,
        ...(expectedUpdatedAt ? { updatedAt: task.updatedAt } : {}),
      },
    });
    if (!deleted.count) throw new TaskConflictError();
  });
}

export async function listTaskTemplates(userId: string) {
  const prisma = getPrismaClient();
  const templates = await prisma.taskTemplate.findMany({
    where: { ownerId: userId },
    include: { items: true },
    orderBy: { updatedAt: 'desc' },
  });
  return { templates: templates.map(serializeTemplate) };
}

function templateData(input: TaskTemplateInput) {
  const name = input.name.trim();
  const items = input.items.map((item, position) => ({
    label: normalizeLabel(item.label),
    note: item.note?.trim() || null,
    position,
  }));
  if (!name || !items.length) throw new TaskValidationError('invalid_task');
  return { items, name };
}

export async function createTaskTemplate(userId: string, input: TaskTemplateInput) {
  const prisma = getPrismaClient();
  const data = templateData(input);
  const template = await prisma.taskTemplate.create({
    data: { items: { create: data.items }, name: data.name, ownerId: userId },
    include: { items: true },
  });
  return serializeTemplate(template);
}

export async function updateTaskTemplate(
  userId: string,
  templateId: string,
  input: TaskTemplateInput,
) {
  const prisma = getPrismaClient();
  const data = templateData(input);
  const template = await prisma.$transaction(async (transaction) => {
    const current = await transaction.taskTemplate.findFirst({
      where: { id: templateId, ownerId: userId },
      select: { id: true },
    });
    if (!current) throw new TaskNotFoundError('task_template_not_found');
    await transaction.taskTemplateItem.deleteMany({ where: { taskTemplateId: current.id } });
    return transaction.taskTemplate.update({
      where: { id: current.id },
      data: { items: { create: data.items }, name: data.name },
      include: { items: true },
    });
  });
  return serializeTemplate(template);
}

export async function deleteTaskTemplate(userId: string, templateId: string) {
  const prisma = getPrismaClient();
  const deleted = await prisma.taskTemplate.deleteMany({
    where: { id: templateId, ownerId: userId },
  });
  if (!deleted.count) throw new TaskNotFoundError('task_template_not_found');
}

export async function applyTaskTemplate(userId: string, templateId: string, tripId: string) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const template = await transaction.taskTemplate.findFirst({
      where: { id: templateId, ownerId: userId },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (!template) throw new TaskNotFoundError('task_template_not_found');
    await transaction.task.createMany({
      data: template.items.map((item) => ({
        label: item.label,
        note: item.note,
        tripId,
      })),
    });
    return { createdCount: template.items.length };
  });
}
