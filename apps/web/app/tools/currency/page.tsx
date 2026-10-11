import { CurrencyConverter } from '@/components/currency-converter';
import { journalSerif } from '@/components/memories/journal-font';

/** The converter sets its title and figures in the Memories serif. */
export default function CurrencyPage() {
  return (
    <div className={journalSerif.variable}>
      <CurrencyConverter />
    </div>
  );
}
