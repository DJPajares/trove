type NumberSeparators = {
  decimal: string;
  group: string;
};

function getNumberSeparators(locale: string): NumberSeparators {
  const parts = new Intl.NumberFormat(locale).formatToParts(12_345.6);
  return {
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeMoneyInput(value: string, locale: string) {
  const { decimal, group } = getNumberSeparators(locale);
  let normalized = value.trim().replace(/[\s\u00a0\u202f]/g, '');

  if (!normalized) return '';
  if (group) normalized = normalized.replace(new RegExp(escapeRegExp(group), 'g'), '');
  if (decimal !== '.') normalized = normalized.replace(new RegExp(escapeRegExp(decimal), 'g'), '.');
  if (normalized.startsWith('.')) normalized = `0${normalized}`;

  return /^(?:0|[1-9]\d{0,9})(?:\.\d{0,2})?$/.test(normalized) ? normalized : null;
}

export function formatMoneyInput(value: string, locale: string, grouping = true) {
  if (!value) return '';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  const fraction = value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;

  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: Math.min(fraction, 2),
    useGrouping: grouping,
  }).format(parsed);
}
