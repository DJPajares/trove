import type { ReactNode } from 'react';

import { PageState } from '@/components/page-state';

type PagePlaceholderProps = {
  description: string;
  eyebrow: string;
  icon: ReactNode;
  status: string;
  title: string;
};

export function PagePlaceholder({
  description,
  eyebrow,
  icon,
  status,
  title,
}: PagePlaceholderProps) {
  return (
    <section
      aria-labelledby="placeholder-heading"
      className="grid min-h-[calc(100dvh-10rem)] items-center"
    >
      <PageState
        description={description}
        detail={status}
        eyebrow={eyebrow}
        headingId="placeholder-heading"
        icon={icon}
        title={title}
      />
    </section>
  );
}
