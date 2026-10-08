import { getSafeRedirectPath } from '@/lib/auth/redirect';

export type EmailLinkError = 'invalidLink' | 'expiredLink' | 'configurationError' | 'networkError';
export type EmailLink = {
  next: string;
  recovery: boolean;
} & (
  | { kind: 'otp'; tokenHash: string; type: 'email' | 'recovery' }
  | { kind: 'code'; code: string; flowId?: string }
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
);

const credentialKeys = ['token_hash', 'code', 'access_token', 'refresh_token'];
const singletonKeys = [
  ...credentialKeys,
  'type',
  'flow',
  'next',
  'sb_flow_id',
  'error',
  'error_code',
];

/** Strictly parse once; URL hints never authorize a recovery session. */
export function parseEmailLink(url: URL): { link: EmailLink } | { error: EmailLinkError } {
  const params = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.slice(1));
  for (const [key, value] of fragment) params.append(key, value);
  if (singletonKeys.some((key) => params.getAll(key).length > 1)) return { error: 'invalidLink' };
  if (params.has('error') || params.has('error_code')) {
    return { error: params.get('error_code') === 'otp_expired' ? 'expiredLink' : 'invalidLink' };
  }
  const type = params.get('type');
  const flow = params.get('flow');
  if (
    (type && !['email', 'signup', 'recovery'].includes(type)) ||
    (flow && !['signup', 'recovery'].includes(flow))
  )
    return { error: 'invalidLink' };
  if (
    (type === 'recovery' && flow === 'signup') ||
    ((type === 'email' || type === 'signup') && flow === 'recovery')
  )
    return { error: 'invalidLink' };
  const next = getSafeRedirectPath(params.get('next'));
  const recovery = type === 'recovery' || flow === 'recovery';
  const tokenHash = params.get('token_hash');
  const code = params.get('code');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const present = credentialKeys.filter((key) => params.has(key));
  if (tokenHash && present.length === 1 && type) {
    if (!/^[a-zA-Z0-9_-]{16,512}$/.test(tokenHash)) return { error: 'invalidLink' };
    return {
      link: { kind: 'otp', tokenHash, type: recovery ? 'recovery' : 'email', next, recovery },
    };
  }
  if (code && present.length === 1 && /^[a-zA-Z0-9_-]{8,512}$/.test(code)) {
    const flowId = params.get('sb_flow_id');
    if (flowId !== null && !/^[a-zA-Z0-9_-]{8,64}$/.test(flowId)) return { error: 'invalidLink' };
    return { link: { kind: 'code', code, ...(flowId ? { flowId } : {}), next, recovery } };
  }
  if (
    accessToken &&
    refreshToken &&
    present.length === 2 &&
    accessToken.length <= 16384 &&
    refreshToken.length <= 2048 &&
    /^[\w-]+\.[\w-]+\.[\w-]+$/.test(accessToken) &&
    /^[\w-]+$/.test(refreshToken)
  ) {
    return { link: { kind: 'tokens', accessToken, refreshToken, next, recovery } };
  }
  return { error: 'invalidLink' };
}

/** Reuse the URL parser to validate untrusted JSON before making any Auth calls. */
export function validateEmailLink(value: unknown): EmailLink | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const fields =
    input.kind === 'otp'
      ? ['tokenHash', 'type']
      : input.kind === 'code'
        ? ['code', 'flowId']
        : ['accessToken', 'refreshToken'];
  if (Object.keys(input).some((key) => !['kind', 'next', 'recovery', ...fields].includes(key)))
    return null;
  const url = new URL('https://trove.invalid/auth/confirm');
  if (typeof input.next === 'string') url.searchParams.set('next', input.next);
  if (typeof input.recovery !== 'boolean') return null;
  url.searchParams.set('flow', input.recovery ? 'recovery' : 'signup');
  if (
    input.kind === 'otp' &&
    typeof input.tokenHash === 'string' &&
    (input.type === 'email' || input.type === 'recovery')
  ) {
    url.searchParams.set('token_hash', input.tokenHash);
    url.searchParams.set('type', input.type);
  } else if (input.kind === 'code' && typeof input.code === 'string') {
    url.searchParams.set('code', input.code);
    if (input.flowId !== undefined) {
      if (typeof input.flowId !== 'string') return null;
      url.searchParams.set('sb_flow_id', input.flowId);
    }
  } else if (
    input.kind === 'tokens' &&
    typeof input.accessToken === 'string' &&
    typeof input.refreshToken === 'string'
  ) {
    url.searchParams.set('access_token', input.accessToken);
    url.searchParams.set('refresh_token', input.refreshToken);
  } else return null;
  const result = parseEmailLink(url);
  return 'link' in result ? result.link : null;
}
