import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { AuthShell } from '@/components/auth-shell';
import { BrandMark } from '@/components/brand-logo';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export function AuthPanel({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description: string;
  children: ReactNode;
}>) {
  const t = useTranslations('auth');
  return (
    <AuthShell headingId="email-flow-heading">
      <Card className="w-full max-w-md sm:[--card-spacing:--spacing(6)]">
        <CardHeader>
          <BrandMark
            className="mb-4 size-11 rounded-[25%] shadow-[var(--shadow-control)]"
            presentation="tile"
          />
          <p className="text-sm font-medium tracking-[0.01em] text-brand">{t('eyebrow')}</p>
          <h1
            className="mt-2 text-[clamp(1.75rem,5vw,2rem)] leading-tight font-semibold tracking-[-0.025em] text-pretty text-foreground"
            id="email-flow-heading"
          >
            {title}
          </h1>
          <p className="mt-2 text-base leading-7 text-pretty text-muted-foreground">
            {description}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">{children}</CardContent>
      </Card>
    </AuthShell>
  );
}
