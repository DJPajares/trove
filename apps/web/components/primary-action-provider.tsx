'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  resolvePrimaryActionSlot,
  type PrimaryAction,
  type PrimaryActionSlot,
} from '@/lib/shell/primary-action';

type PrimaryActionContextValue = {
  primaryAction: PrimaryAction | null;
  registerPrimaryAction: (owner: symbol, action: PrimaryAction | null) => void;
};

const PrimaryActionContext = createContext<PrimaryActionContextValue | null>(null);

/**
 * Holds whichever create action the current screen has claimed, so the bottom
 * bar's plus button can perform it without the bar having to know which screens
 * exist. A registry rather than a sheet host: unlike trip creation, the sheet
 * each action opens already belongs to the screen that owns the data.
 */
export function PrimaryActionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [slot, setSlot] = useState<PrimaryActionSlot>(null);
  const registerPrimaryAction = useCallback(
    (owner: symbol, action: PrimaryAction | null) =>
      setSlot((current) => resolvePrimaryActionSlot(current, owner, action)),
    [],
  );
  const value = useMemo(
    () => ({ primaryAction: slot?.action ?? null, registerPrimaryAction }),
    [registerPrimaryAction, slot],
  );

  return <PrimaryActionContext.Provider value={value}>{children}</PrimaryActionContext.Provider>;
}

/**
 * The action the current screen has claimed, or `null` where none has and the
 * button keeps its global meaning. Null rather than a thrown error outside the
 * provider, so a screen that claims the button still renders on its own.
 */
export function usePrimaryAction() {
  return useContext(PrimaryActionContext)?.primaryAction ?? null;
}

type RegisterPrimaryActionOptions = {
  enabled: boolean;
  label: string;
  onTrigger: () => void;
};

/**
 * Claims the bottom bar's plus button for this screen while it is mounted.
 *
 * `onTrigger` is read through a ref instead of being a dependency: the screens
 * that claim the button are the ones holding form state, and re-registering on
 * every keystroke would be a state update per keystroke for a handler that has
 * not changed. Passing `enabled` false hands the button back — the itinerary's
 * whole-trip overview has no one day to add a stop to.
 */
export function useRegisterPrimaryAction({
  enabled,
  label,
  onTrigger,
}: Readonly<RegisterPrimaryActionOptions>) {
  const register = useContext(PrimaryActionContext)?.registerPrimaryAction;
  const ownerRef = useRef<symbol | null>(null);
  ownerRef.current ??= Symbol('primary-action');
  const owner = ownerRef.current;
  const handler = useRef(onTrigger);

  useEffect(() => {
    handler.current = onTrigger;
  });

  useEffect(() => {
    if (!register) return;

    if (!enabled) {
      register(owner, null);
      return;
    }

    register(owner, { label, onTrigger: () => handler.current() });

    return () => register(owner, null);
  }, [enabled, label, owner, register]);
}
