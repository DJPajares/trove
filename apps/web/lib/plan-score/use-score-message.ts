'use client';

import { useTranslations } from 'next-intl';

import { MINUTE_VALUE_KEYS, readableDuration } from './readable-duration';

type Values = Record<string, string | number | Date>;

/**
 * Plan Score sentences, with any length of time written the way a person reads
 * it. The score reports minutes; the sentence says "45 minutes" or "5.5 hours".
 */
export function useScoreMessage() {
  const t = useTranslations('planScore');
  return (key: string, values?: Values | null) => {
    if (!values) return t(key as never);
    const readable: Values = { ...values };
    for (const name of MINUTE_VALUE_KEYS) {
      const value = values[name];
      if (typeof value !== 'number') continue;
      const { count, unit } = readableDuration(value);
      readable[name] = t(`duration.${unit}`, { count });
    }
    return t(key as never, readable as never);
  };
}
