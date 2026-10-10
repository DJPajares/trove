import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import '../src/environment.js';

/** Same authenticated, audited operation as Postman. No direct database mutation. */
async function main() {
  const ownerId = z.uuid().parse(process.argv[2]);
  const reason = z.string().trim().min(1).max(500).parse(process.argv[3]);
  if (process.argv.length !== 4) throw new Error('Usage: pnpm ai:reset-quota <user-id> <reason>');
  const base = new URL(process.env.TROVE_ADMIN_API_URL ?? 'http://localhost:3001');
  if (
    base.protocol !== 'https:' &&
    !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  )
    throw new Error('Admin API requires HTTPS outside localhost.');
  const token = process.env.TROVE_ADMIN_TOKEN;
  if (!token) throw new Error('Set TROVE_ADMIN_TOKEN to a scoped operator credential.');
  const response = await fetch(new URL(`/admin/users/${ownerId}/ai-planner/reset`, base), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({ reason }),
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  const result = (await response.json()) as { code?: string };
  if (!response.ok) throw new Error(result.code ?? 'Admin operation failed.');
  console.log(JSON.stringify(result));
}

main().catch(() => {
  console.error(
    'AI credit reset failed. Check the target UUID, reason, admin credential and API configuration.',
  );
  process.exitCode = 1;
});
