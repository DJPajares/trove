import type { ReactNode } from 'react';

import { AuthShell } from '@/components/auth-shell';

/**
 * An account step with one job - choose a new password, confirm an email,
 * request a fresh link: its title is the greeting on the photograph and its
 * description the line beneath, with the step's form on the sheet.
 */
export function AuthPanel({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description: string;
  children: ReactNode;
}>) {
  return (
    <AuthShell lead={description} title={title}>
      {children}
    </AuthShell>
  );
}
