import { randomUUID } from 'node:crypto';

// Small stateful store for business-rule tests. PostgreSQL verifies constraints and locks separately.
export function matches(value: any, filter: any): boolean {
  if (filter === undefined) return true;
  if (filter && typeof filter === 'object' && !(filter instanceof Date)) {
    if ('in' in filter && !filter.in.includes(value)) return false;
    if ('not' in filter && matches(value, filter.not)) return false;
    if ('gt' in filter && !(value > filter.gt)) return false;
    if ('gte' in filter && !(value >= filter.gte)) return false;
    if ('lte' in filter && !(value <= filter.lte)) return false;
    return true;
  }
  return value instanceof Date && filter instanceof Date
    ? value.getTime() === filter.getTime()
    : value === filter;
}

export function creditModels(now: Date) {
  const tables = new Map<string, Map<string, any>>();
  const models: Record<string, any> = {};
  for (const name of [
    'userEntitlement',
    'aiCreditPeriod',
    'aiCreditAction',
    'aiCreditEvent',
    'adminOperationAudit',
  ]) {
    const rows = new Map<string, any>();
    tables.set(name, rows);
    const key = (row: any) =>
      name === 'userEntitlement' ? row.ownerId : name === 'aiCreditAction' ? row.runId : row.id;
    const filter = (where: any = {}) =>
      [...rows.values()].filter((row) =>
        Object.entries(where).every(([field, value]) =>
          field.includes('_') && value && typeof value === 'object'
            ? Object.entries(value).every(([k, v]) => matches(row[k], v))
            : matches(row[field], value),
        ),
      );
    const model = {
      async findMany({ where, orderBy, distinct }: any = {}) {
        let values = filter(where);
        if (orderBy)
          for (const [field, direction] of Object.entries(orderBy))
            values = values.toSorted(
              (a, b) =>
                (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) *
                (direction === 'desc' ? -1 : 1),
            );
        if (distinct)
          values = values.filter(
            (v, i, all) =>
              all.findIndex((other) =>
                distinct.every((field: string) => other[field] === v[field]),
              ) === i,
          );
        return values.map((v) => ({ ...v }));
      },
      async findFirst(args: any = {}) {
        return (await model.findMany(args))[0] ?? null;
      },
      async findUnique(args: any) {
        return model.findFirst(args);
      },
      async count(args: any) {
        return filter(args.where).length;
      },
      async create({ data }: any) {
        const row = {
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...(name === 'userEntitlement'
            ? { planKey: 'free', subscriptionStatus: 'active', monthlyAnchorAt: null }
            : name === 'aiCreditPeriod'
              ? { used: 0, reserved: 0, sequence: 0 }
              : name === 'aiCreditAction'
                ? { state: 'reserved', settledAt: null, settlementReason: null }
                : {}),
          ...data,
        };
        rows.set(key(row), row);
        return { ...row };
      },
      async upsert({ where, create, update }: any) {
        return (await model.findFirst({ where }))
          ? model.update({ where, data: update })
          : model.create({ data: create });
      },
      async updateMany({ where, data }: any) {
        const values = filter(where);
        for (const row of values)
          for (const [field, value] of Object.entries(data)) {
            if (
              value &&
              typeof value === 'object' &&
              ('increment' in value || 'decrement' in value)
            )
              row[field] += Number((value as any).increment ?? -(value as any).decrement);
            else row[field] = value;
          }
        return { count: values.length };
      },
      async update({ where, data }: any) {
        await model.updateMany({ where, data });
        const row = await model.findFirst({ where });
        if (!row) throw new Error('not_found');
        return row;
      },
    };
    models[name] = model;
  }
  return { models, tables };
}
