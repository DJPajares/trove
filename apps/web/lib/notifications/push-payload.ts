export type PushPayload = {
  body: string;
  expiresAt: string;
  ownerId: string;
  tag: string;
  title: string;
  url: string;
};

export function shouldShowPush(
  value: unknown,
  activeOwner: string | null,
  now = Date.now(),
): value is PushPayload {
  if (!value || typeof value !== 'object' || !activeOwner) return false;
  const payload = value as Record<string, unknown>;
  if (
    !['body', 'expiresAt', 'ownerId', 'tag', 'title', 'url'].every(
      (key) => typeof payload[key] === 'string',
    )
  )
    return false;
  const expiry = Date.parse(payload.expiresAt as string);
  return (
    payload.ownerId === activeOwner &&
    Number.isFinite(expiry) &&
    expiry > now &&
    (payload.url as string).startsWith('/trips/') &&
    (payload.url as string).length <= 300 &&
    (payload.title as string).length <= 120 &&
    (payload.body as string).length <= 500
  );
}
