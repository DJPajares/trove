import type { ReactNode } from 'react';

import { journalSerif } from '@/components/memories/journal-font';

export default function AtlasLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className={journalSerif.variable}>{children}</div>;
}
