'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

import { motionDuration, motionEase } from '@/lib/motion';

export function TroveMotionProvider({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: motionDuration.standard, ease: motionEase }}
    >
      {children}
    </MotionConfig>
  );
}
