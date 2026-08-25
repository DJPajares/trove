import { getEditorialImagesEnvironment } from '../environment.js';
import { CachedEditorialImagesService } from './cached-editorial-images.js';
import { getEditorialImageHourlyBudget } from './editorial-image-budget.js';
import { type EditorialImagesLogger } from './editorial-images.js';
import { PexelsEditorialImageProvider } from './pexels-editorial-images.js';
import type { ProviderCallSource } from './provider-usage.js';

/**
 * Returns null when editorial imagery is switched off *or* unconfigured, so the
 * kill switch and a missing key are one code path rather than two. Every
 * consumer already has to handle "no photograph"; this makes sure that is the
 * only state it ever has to handle.
 */
export function createEditorialImagesService(options: {
  beforeProviderRequest?: () => Promise<void>;
  environment?: Record<string, string | undefined>;
  logger?: EditorialImagesLogger;
  source: ProviderCallSource;
}) {
  const { beforeProviderRequest, environment = process.env, logger, source } = options;
  const editorialImagesEnvironment = getEditorialImagesEnvironment(environment);

  if (!editorialImagesEnvironment) {
    return null;
  }

  return new CachedEditorialImagesService(
    new PexelsEditorialImageProvider({
      apiKey: editorialImagesEnvironment.pexelsApiKey,
      beforeRequest: beforeProviderRequest,
      hourlyBudget: getEditorialImageHourlyBudget(editorialImagesEnvironment.hourlyBudget),
      source,
    }),
    () => new Date(),
    logger,
    source,
  );
}
