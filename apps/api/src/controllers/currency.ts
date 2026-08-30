import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { CachedCurrencyService } from '../services/cached-currency.js';
import { CurrencyProviderError } from '../services/currency.js';

const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase());

const rateQuerySchema = z
  .object({
    base: currencyCodeSchema,
    quote: currencyCodeSchema,
  })
  .strict()
  .refine((value) => value.base !== value.quote);

function sendProviderError(reply: FastifyReply, error: unknown) {
  if (error instanceof CurrencyProviderError) {
    if (error.code === 'invalid_request') {
      return reply.code(400).send({ code: 'invalid_currency_pair' });
    }

    return reply.code(503).send({
      code:
        error.code === 'invalid_response'
          ? 'currency_provider_invalid_response'
          : 'currency_unavailable',
      provider: 'frankfurter',
      status: 'unavailable',
    });
  }

  throw error;
}

export function createCurrencyControllers(currencyService: CachedCurrencyService) {
  return {
    async listCurrencies(_request: FastifyRequest, reply: FastifyReply) {
      try {
        return reply.send({
          currencies: await currencyService.getCurrencies(),
          provider: 'frankfurter',
        });
      } catch (error) {
        return sendProviderError(reply, error);
      }
    },

    /**
     * The whole daily board in one response. A client that holds it can convert
     * any pair offline and without a request per keystroke, which is the point
     * of caching a snapshot rather than a pair.
     */
    async getRates(_request: FastifyRequest, reply: FastifyReply) {
      try {
        return reply.send(await currencyService.getRateBoard());
      } catch (error) {
        return sendProviderError(reply, error);
      }
    },

    async getRate(request: FastifyRequest, reply: FastifyReply) {
      const query = rateQuerySchema.safeParse(request.query);

      if (!query.success) {
        return reply.code(400).send({ code: 'invalid_currency_pair' });
      }

      try {
        return reply.send({
          rate: await currencyService.getRate(query.data.base, query.data.quote),
        });
      } catch (error) {
        return sendProviderError(reply, error);
      }
    },
  };
}
