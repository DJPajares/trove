/** Browser-wide auth departure state, shared by rendering and request transport. */
export type AuthTransition =
  'idle' | 'signing-out' | 'session-expired' | 'sign-out-failed' | 'cleanup-failed';

let state: AuthTransition = 'idle';
let expectsSession = false;
let requestController: AbortController | undefined;
const listeners = new Set<() => void>();

export const getAuthTransition = () => state;
export const getServerAuthTransition = (): AuthTransition => 'idle';
export const isAuthDeparting = () => !['idle', 'sign-out-failed'].includes(state);

export function subscribeAuthTransition(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function expectAuthSession(expected: boolean) {
  expectsSession = expected;
}

export function setAuthTransition(next: AuthTransition) {
  if (state === next) return;
  state = next;
  if (isAuthDeparting()) requestController?.abort();
  else requestController = undefined;
  listeners.forEach((listener) => listener());
}

export function expireAuthSession() {
  if (expectsSession && !isAuthDeparting()) setAuthTransition('session-expired');
}

export function assertAuthRequestsAllowed() {
  if (isAuthDeparting()) throw new DOMException('Authentication transition', 'AbortError');
}

export function authRequestSignal() {
  assertAuthRequestsAllowed();
  requestController ??= new AbortController();
  return requestController.signal;
}
