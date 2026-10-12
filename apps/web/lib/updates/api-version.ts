import { isSemver } from './version';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** The deployed API's version from its public health check, or null when unreachable. */
export async function fetchApiVersion(signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(`${apiUrl}/health`, { cache: 'no-store', signal });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const version =
      typeof body === 'object' && body !== null && 'version' in body ? body.version : null;
    return isSemver(version) ? version : null;
  } catch {
    return null;
  }
}
