import { createTranslator } from 'next-intl';
import { expect, test, vi } from 'vitest';
import messages from '../messages/en.json';

vi.mock('next-intl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-intl')>()),
  useLocale: () => 'en',
  useTranslations: (namespace: 'tripMode.views.weather') =>
    createTranslator({ locale: 'en', messages, namespace }),
}));
const { useWeatherEvidenceDescription } =
  await import('../lib/weather/use-evidence-description.ts');

test('forecast descriptions identify original date, zone and retrieval time', () => {
  const describe = useWeatherEvidenceDescription();
  expect(
    describe({
      kind: 'forecast',
      date: '2026-10-03',
      timeZone: 'Asia/Tokyo',
      fetchedAt: '2026-10-02T20:00Z',
    }),
  ).toBe('Forecast for Oct 3, 2026 (Asia/Tokyo). Retrieved Oct 3, 2026, 5:00 AM');
});
test('legacy archived predictions keep unknown age rather than acquiring a new timestamp', () => {
  expect(
    useWeatherEvidenceDescription()({
      kind: 'archived',
      date: '2026-10-02',
      timeZone: 'Asia/Tokyo',
    }),
  ).toBe('Archived forecast for Oct 2, 2026 (Asia/Tokyo). Retrieval time unknown');
});
test('observation descriptions use the evidence timezone', () => {
  expect(
    useWeatherEvidenceDescription()({
      kind: 'current',
      observedAt: '2026-10-03T11:45',
      timeZone: 'Asia/Tokyo',
    }),
  ).toBe('Observed Oct 3, 2026, 11:45 AM (Asia/Tokyo)');
});
