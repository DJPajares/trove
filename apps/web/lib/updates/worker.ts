import { parseReleaseManifest, RELEASE_MESSAGE, type ReleaseManifest } from './release';

export const TROVE_WORKER_PATH = '/serwist/sw.js';

export function requestWorkerRelease(
  worker: ServiceWorker,
  timeoutMs = 3000,
): Promise<ReleaseManifest | null> {
  return new Promise((resolve) => {
    let channel: MessageChannel;
    try {
      channel = new MessageChannel();
    } catch {
      resolve(null);
      return;
    }
    const finish = (release: ReleaseManifest | null) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(release);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    channel.port1.onmessage = (event) => finish(parseReleaseManifest(event.data));
    channel.port1.onmessageerror = () => finish(null);
    try {
      worker.postMessage({ type: RELEASE_MESSAGE }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

export function isTroveWorker(worker: ServiceWorker | null): worker is ServiceWorker {
  if (!worker) return false;
  try {
    return new URL(worker.scriptURL).pathname === TROVE_WORKER_PATH;
  } catch {
    return false;
  }
}
