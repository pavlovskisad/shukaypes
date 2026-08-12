// Whether the server has told us this visitor may not have an account.
//
// Tiny and separate from gameStore on purpose: gameStore is about the
// state of a walk, and this is about whether there is a walk to have.
// It is also the one error in the app that must be VISIBLE — every
// other API failure is caught and written to `lastSyncError`, which no
// component reads, so an uninvited person would otherwise see a shell
// that loads and then does nothing, forever, with no explanation.
//
// Not persisted. If the gate is turned off, or a code is added to the
// URL, the next launch should get a clean answer from the server rather
// than a remembered "no".

import { create } from 'zustand';

interface AccessState {
  inviteRequired: boolean;
  setInviteRequired: (v: boolean) => void;
}

export const useAccessStore = create<AccessState>((set) => ({
  inviteRequired: false,
  setInviteRequired: (v) => set({ inviteRequired: v }),
}));

/**
 * Callable from non-React code (the fetch wrapper) without importing a
 * hook into it.
 */
export function markInviteRequired(): void {
  useAccessStore.getState().setInviteRequired(true);
}
