import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  createExpense,
  deleteExpense,
  ExpenseConflictError,
  ExpenseNotFoundError,
  ExpenseValidationError,
  listExpenses,
  updateExpense,
  updateTripBudget,
} from '../services/expenses.js';
import { getBearerToken } from '../services/request-auth.js';

const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();
const expenseParamsSchema = z.object({ expenseId: z.uuid(), tripId: z.uuid() }).strict();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const moneySchema = z
  .object({
    amount: z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/),
    currencyCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .transform((value) => value.toUpperCase()),
  })
  .strict();
const expenseFields = {
  amount: moneySchema.shape.amount,
  category: z
    .enum(['food', 'transport', 'stay', 'activities', 'shopping', 'other'])
    .nullable()
    .optional(),
  currencyCode: moneySchema.shape.currencyCode,
  itineraryItemId: z.uuid().nullable().optional(),
  localDate: dateSchema.nullable().optional(),
  localTime: timeSchema.nullable().optional(),
  note: z.string().trim().max(5_000).nullable().optional(),
  title: z.string().trim().max(300).nullable().optional(),
  tripPlaceId: z.uuid().nullable().optional(),
} as const;
const createExpenseSchema = z
  .object({ ...expenseFields, clientExpenseId: z.uuid().optional() })
  .strict()
  .refine((value) => !value.localTime || Boolean(value.localDate), {
    message: 'invalid_expense_time',
  });
const updateExpenseSchema = z
  .object({
    ...expenseFields,
    amount: expenseFields.amount.optional(),
    currencyCode: expenseFields.currencyCode.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined));
const budgetSchema = z.object({ budget: moneySchema.nullable() }).strict();

function getRequestContext(request: FastifyRequest, reply: FastifyReply) {
  const accessToken = getBearerToken(request.headers.authorization);
  if (!request.authUserId || !accessToken) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }
  return { userId: request.authUserId };
}

function handleError(reply: FastifyReply, error: unknown) {
  if (error instanceof ExpenseConflictError) return reply.code(409).send({ code: error.message });
  if (error instanceof ExpenseNotFoundError) return reply.code(404).send({ code: error.message });
  if (error instanceof ExpenseValidationError) return reply.code(400).send({ code: error.code });
  throw error;
}

function getExpectedUpdatedAt(request: FastifyRequest) {
  const value = request.headers['x-trove-expected-updated-at'];
  return typeof value === 'string' ? value : undefined;
}

export function createExpenseControllers() {
  return {
    async list(request: FastifyRequest, reply: FastifyReply) {
      const context = getRequestContext(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      if (!context) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_trip_id' });
      try {
        return reply.send(await listExpenses(context.userId, params.data.tripId));
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async create(request: FastifyRequest, reply: FastifyReply) {
      const context = getRequestContext(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      const body = createExpenseSchema.safeParse(request.body);
      if (!context) return;
      if (!params.success || !body.success)
        return reply.code(400).send({ code: 'invalid_expense' });
      try {
        const { clientExpenseId, ...input } = body.data;
        return reply.code(201).send({
          expense: await createExpense(
            context.userId,
            params.data.tripId,
            {
              ...input,
              category: input.category ?? null,
              itineraryItemId: input.itineraryItemId ?? null,
              localDate: input.localDate ?? null,
              localTime: input.localTime ?? null,
              note: input.note ?? null,
              title: input.title ?? null,
              tripPlaceId: input.tripPlaceId ?? null,
            },
            clientExpenseId,
          ),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async update(request: FastifyRequest, reply: FastifyReply) {
      const context = getRequestContext(request, reply);
      const params = expenseParamsSchema.safeParse(request.params);
      const body = updateExpenseSchema.safeParse(request.body);
      if (!context) return;
      if (!params.success || !body.success)
        return reply.code(400).send({ code: 'invalid_expense' });
      try {
        return reply.send({
          expense: await updateExpense(
            context.userId,
            params.data.tripId,
            params.data.expenseId,
            body.data,
            getExpectedUpdatedAt(request),
          ),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async remove(request: FastifyRequest, reply: FastifyReply) {
      const context = getRequestContext(request, reply);
      const params = expenseParamsSchema.safeParse(request.params);
      if (!context) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_expense_id' });
      try {
        await deleteExpense(
          context.userId,
          params.data.tripId,
          params.data.expenseId,
          getExpectedUpdatedAt(request),
        );
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async updateBudget(request: FastifyRequest, reply: FastifyReply) {
      const context = getRequestContext(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      const body = budgetSchema.safeParse(request.body);
      if (!context) return;
      if (!params.success || !body.success) return reply.code(400).send({ code: 'invalid_budget' });
      try {
        return reply.send({
          budget: await updateTripBudget(context.userId, params.data.tripId, body.data.budget),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  };
}
