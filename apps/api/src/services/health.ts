import type { ApiHealth } from '@trove/types';

import { API_VERSION } from '../version.js';

export function getHealthStatus(): ApiHealth {
  return { status: 'ok', version: API_VERSION };
}
