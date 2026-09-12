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

//
// THE DOOR (D-69) lives here too, for the same reason: the server
// refuses everything but /auth/* until an account is registered (and
// verified, when mail is configured), and that refusal must become a
// screen, not a silent shell. `door` is what /auth/me last said —
// 'open', 'register' or 'verify' — and null until it has said anything.
// A 403 on any other route only PROMPTS a re-read of /auth/me
// (markRegistrationRequired); the screen is always drawn from the
// server's own answer, never from a stray refused request.

import { create } from 'zustand';
import type { DoorState, Me } from '../services/api';

interface AccessState {
  inviteRequired: boolean;
  setInviteRequired: (v: boolean) => void;
  door: DoorState | null;
  me: Me | null;
  // Bumped by a refused request; the door host re-reads /auth/me when
  // it changes.
  doorNudge: number;
  // A password-reset token picked out of the URL at boot; the door
  // opens on the new-password screen while one is held.
  resetToken: string | null;
  // Which screen the door should open on when it has a choice: after
  // a logout the person wants to log in, not register again.
  doorPrefer: 'login' | null;
  // A one-line notice for the door to show first (a strings.auth key),
  // e.g. that the link they arrived on has expired.
  doorNotice: string | null;
  // The account sheet over the map: which screen it opens on, or null
  // while it is closed. The dog's two answers at the gate set it; the
  // door opening clears it.
  doorSheet: 'register' | 'login' | 'verify' | 'reset' | null;
  setMe: (me: Me | null) => void;
  // The server could not be asked (offline, a deploy). The app behaves
  // as before the door existed; a 403 later nudges a re-read.
  assumeOpen: () => void;
  nudgeDoor: () => void;
  openDoorSheet: (s: 'register' | 'login' | 'verify' | 'reset') => void;
  closeDoorSheet: () => void;
  setResetToken: (t: string | null) => void;
  setDoorPrefer: (p: 'login' | null) => void;
  setDoorNotice: (n: string | null) => void;
}

export const useAccessStore = create<AccessState>((set) => ({
  inviteRequired: false,
  setInviteRequired: (v) => set({ inviteRequired: v }),
  door: null,
  me: null,
  doorNudge: 0,
  resetToken: null,
  doorPrefer: null,
  doorNotice: null,
  doorSheet: null,
  setMe: (me) =>
    set((s) => ({
      me,
      door: me ? me.door : null,
      // Through: the sheet has nothing left to ask. Waiting on the link:
      // the sheet shows that, whatever it was showing. Otherwise leave
      // the sheet where the person put it.
      doorSheet: !me || me.door === 'open' ? null : me.door === 'verify' ? 'verify' : s.doorSheet,
    })),
  assumeOpen: () => set((s) => (s.door === null ? { door: 'open' } : {})),
  nudgeDoor: () => set((s) => ({ doorNudge: s.doorNudge + 1 })),
  openDoorSheet: (doorSheet) => set({ doorSheet }),
  closeDoorSheet: () => set({ doorSheet: null }),
  setResetToken: (resetToken) => set({ resetToken }),
  setDoorPrefer: (doorPrefer) => set({ doorPrefer }),
  setDoorNotice: (doorNotice) => set({ doorNotice }),
}));

/**
 * Callable from non-React code (the fetch wrapper) without importing a
 * hook into it.
 */
export function markInviteRequired(): void {
  useAccessStore.getState().setInviteRequired(true);
}

/**
 * The server said "registration required" to some request. Callable
 * from the fetch wrapper. Does not open the door by itself — see the
 * note at the top.
 */
export function markRegistrationRequired(): void {
  const s = useAccessStore.getState();
  if (s.door === 'open' || s.door === null) s.nudgeDoor();
}
