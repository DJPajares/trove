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

test('forecast descriptions keep the applicable date and zone without retrieval metadata', () => {
  const describe = useWeatherEvidenceDescription();
  expect(
    describe({
      kind: 'forecast',
      date: '2026-10-03',
      timeZone: 'Asia/Tokyo',
      fetchedAt: '2026-10-02T20:00Z',
    }),
  ).toBe('Forecast for Oct 3, 2026 (Asia/Tokyo)');
});
test('archived predictions retain their forecast identity without unknown-age metadata', () => {
  expect(
    useWeatherEvidenceDescription()({
      kind: 'archived',
      date: '2026-10-02',
      timeZone: 'Asia/Tokyo',
    }),
  ).toBe('Archived forecast for Oct 2, 2026 (Asia/Tokyo)');
});
test('current descriptions keep the timezone without exposing observation timestamps', () => {
  expect(
    useWeatherEvidenceDescription()({
      kind: 'current',
      observedAt: '2026-10-03T11:45',
      timeZone: 'Asia/Tokyo',
    }),
  ).toBe('Current conditions (Asia/Tokyo)');
});
