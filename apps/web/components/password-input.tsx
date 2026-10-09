'use client';

import { EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

export function PasswordInput({
  className,
  disabled,
  id,
  ...props
}: Readonly<Omit<ComponentProps<typeof Input>, 'type'>>) {
  const t = useTranslations('auth');
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        className={cn(className, 'pe-12')}
        disabled={disabled}
        id={inputId}
        type={visible ? 'text' : 'password'}
      />
      <Button
        aria-controls={inputId}
        aria-label={t(visible ? 'hidePassword' : 'showPassword')}
        className="absolute inset-y-0 end-0 text-muted-foreground"
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
        size="icon"
        type="button"
        variant="ghost"
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Icons.Preview aria-hidden="true" />}
      </Button>
    </div>
  );
}
