'use client';

import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';

import { type TripPresence, useUpdateMyPresence } from '@sendero/collaboration/client';

type PresenceFocus = {
  section: TripPresence['focusedSection'];
  label: string;
};

type FocusUpdater = (focus: PresenceFocus) => void;

const TripPresenceFocusContext = createContext<FocusUpdater | null>(null);

export function TripPresenceFocusProvider({ children }: { children: React.ReactNode }) {
  const updateMyPresence = useUpdateMyPresence();
  const updateFocus = useCallback<FocusUpdater>(
    focus => {
      updateMyPresence({
        focusedSection: focus.section,
        focusLabel: focus.label,
      });
    },
    [updateMyPresence]
  );
  const value = useMemo(() => updateFocus, [updateFocus]);

  return (
    <TripPresenceFocusContext.Provider value={value}>{children}</TripPresenceFocusContext.Provider>
  );
}

export function TripPresenceFocus({
  section,
  label,
  children,
}: PresenceFocus & {
  children: React.ReactNode;
}) {
  const updateFocus = useTripPresenceFocus({ section, label });

  return (
    <div onFocusCapture={updateFocus} onPointerEnter={updateFocus}>
      {children}
    </div>
  );
}

export function TripPresenceMountFocus({ section, label }: PresenceFocus) {
  const updateFocus = useTripPresenceFocus({ section, label });

  useEffect(() => {
    updateFocus();
  }, [updateFocus]);

  return null;
}

export function useTripPresenceFocus({ section, label }: PresenceFocus) {
  const updateFocus = useContext(TripPresenceFocusContext);

  return useCallback(() => {
    updateFocus?.({ section, label });
  }, [label, section, updateFocus]);
}
