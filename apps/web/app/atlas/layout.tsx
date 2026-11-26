import type { ReactNode } from 'react';

import { AtlasPicksTray } from '@/components/atlas/atlas-picks-tray';
import { journalSerif } from '@/components/memories/journal-font';

export default function AtlasLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className={journalSerif.variable}>
      {children}
      <AtlasPicksTray />
    </div>
  );
}
