'use client';

import type { ReactNode } from 'react';
import { create } from 'zustand';

/**
 * Shared right-slot for `SlackChannelNav`. Pages under
 * `/dashboard/channels/slack/*` that want to hang an extra control
 * (e.g. the Setup ↔ Share-install-URL pill row) onto the section nav
 * publish a ReactNode here. The nav reads it and renders it
 * justify-end on the same row as the section pills. Empty by default
 * so /inbox stays untouched.
 */

type Store = {
  rightSlot: ReactNode | null;
  setRightSlot: (n: ReactNode | null) => void;
};

export const useSlackChannelNavStore = create<Store>(set => ({
  rightSlot: null,
  setRightSlot: rightSlot => set({ rightSlot }),
}));
