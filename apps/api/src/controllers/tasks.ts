import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  applyTaskTemplate,
  createTask,
  createTaskTemplate,
  deleteTask,
  deleteTaskTemplate,
  listTasks,
  listTaskTemplates,
  TaskNotFoundError,
  TaskValidationError,
  updateTask,
  updateTaskTemplate,
} from '../services/tasks.js';

const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();
const taskParamsSchema = z.object({ taskId: z.uuid(), tripId: z.uuid() }).strict();
const templateParamsSchema = z.object({ templateId: z.uuid() }).strict();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const contextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('trip') }).strict(),
  z.object({ itineraryDayId: z.uuid(), kind: z.literal('day') }).strict(),
  z.object({ itineraryItemId: z.uuid(), kind: z.literal('item') }).strict(),
]);
const taskFields = {
  completed: z.boolean().optional(),
  context: contextSchema.optional(),
  dueDate: dateSchema.nullable().optional(),
  dueLocalTime: timeSchema.nullable().optional(),
  label: z.string().trim().min(1).max(200).optional(),
  note: z.string().trim().max(5_000).nullable().optional(),
} as const;
const createTaskSchema = z
  .object({ ...taskFields, context: contextSchema, label: z.string().trim().min(1).max(200) })
  .strict()
  .superRefine((value, context) => {
    if (!value.dueDate && value.dueLocalTime) {
      context.addIssue({
        code: 'custom',
        message: 'due_time_requires_date',
        path: ['dueLocalTime'],
      });
    }
  });
const updateTaskSchema = z
  .object(taskFields)
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined))
  .superRefine((value, context) => {
    if (value.dueDate === null && value.dueLocalTime && value.dueLocalTime !== null) {
      context.addIssue({
        code: 'custom',
        message: 'due_time_requires_date',
        path: ['dueLocalTime'],
      });
    }
  });
const templateInputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(200),
            note: z.string().trim().max(5_000).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    name: z.string().trim().min(1).max(100),
  })
  .strict();
const applyTemplateSchema = z.object({ tripId: z.uuid() }).strict();

function getUserId(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }
  return request.authUserId;
}

function handleError(reply: FastifyReply, error: unknown) {
  if (error instanceof TaskNotFoundError) return reply.code(404).send({ code: error.message });
  if (error instanceof TaskValidationError) return reply.code(400).send({ code: error.code });
  throw error;
}

export function createTasksControllers() {
  return {
    async applyTemplate(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = templateParamsSchema.safeParse(request.params);
      const body = applyTemplateSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) return reply.code(400).send({ code: 'invalid_task' });
      try {
        return reply
          .code(201)
          .send(await applyTaskTemplate(userId, params.data.templateId, body.data.tripId));
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async createTask(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      const body = createTaskSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) return reply.code(400).send({ code: 'invalid_task' });
      try {
        return reply
          .code(201)
          .send({ task: await createTask(userId, params.data.tripId, body.data) });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async createTemplate(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const body = templateInputSchema.safeParse(request.body);
      if (!userId) return;
      if (!body.success) return reply.code(400).send({ code: 'invalid_task_template' });
      try {
        return reply.code(201).send({ template: await createTaskTemplate(userId, body.data) });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async deleteTask(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = taskParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_task' });
      try {
        await deleteTask(userId, params.data.tripId, params.data.taskId);
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async deleteTemplate(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = templateParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_task_template' });
      try {
        await deleteTaskTemplate(userId, params.data.templateId);
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async getTasks(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_trip_id' });
      try {
        return reply.send(await listTasks(userId, params.data.tripId));
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async getTemplates(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      if (!userId) return;
      return reply.send(await listTaskTemplates(userId));
    },

    async updateTask(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = taskParamsSchema.safeParse(request.params);
      const body = updateTaskSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) return reply.code(400).send({ code: 'invalid_task' });
      try {
        return reply.send({
          task: await updateTask(userId, params.data.tripId, params.data.taskId, body.data),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async updateTemplate(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = templateParamsSchema.safeParse(request.params);
      const body = templateInputSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success)
        return reply.code(400).send({ code: 'invalid_task_template' });
      try {
        return reply.send({
          template: await updateTaskTemplate(userId, params.data.templateId, body.data),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  };
}
