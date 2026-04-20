'use client';

/**
 * Zustand store for the *client-side* MSCA state.
 *
 * This is the only place in `@sendero/auth` that holds a live `SmartAccount`
 * reference — everything else treats the MSCA as an address + credential id.
 * Kept separate from `useSenderoAuth()` so the store can be rehydrated from
 * localStorage (via `restoreFromStorage`) before Clerk's user is hydrated.
 */

import { create } from 'zustand';
import type { Hex } from 'viem';
import type { UserWallet, StoredCredential, UserProfile } from '@sendero/circle/modular-wallets';

interface MscaState {
  wallet: UserWallet | null;
  credential: StoredCredential | null;
  profile: UserProfile | null;
  address: Hex | null;
  isRestoring: boolean;
  setWallet: (wallet: UserWallet | null) => void;
  setRestoring: (v: boolean) => void;
  clear: () => void;
}

export const useMscaStore = create<MscaState>(set => ({
  wallet: null,
  credential: null,
  profile: null,
  address: null,
  isRestoring: true,
  setWallet: wallet =>
    set(
      wallet
        ? {
            wallet,
            credential: wallet.credential,
            profile: {
              displayName: wallet.displayName,
              email: wallet.email,
              phone: wallet.phone,
            },
            address: wallet.address,
            isRestoring: false,
          }
        : {
            wallet: null,
            credential: null,
            profile: null,
            address: null,
            isRestoring: false,
          }
    ),
  setRestoring: isRestoring => set({ isRestoring }),
  clear: () =>
    set({
      wallet: null,
      credential: null,
      profile: null,
      address: null,
      isRestoring: false,
    }),
}));
