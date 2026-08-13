// Is the app actually talking to the server right now?
//
// `gameStore.lastSyncError` has been written at nineteen sites and read
// by nothing. Every API failure in this app is caught and quietly
// discarded, so on a metro platform the map simply stops: no spinner, no
// message, paws that do not appear, a dog that does not answer. The most
// common failure in the target environment is also the most invisible.
//
// This store exists so one component can say so. Kept separate from
// gameStore on purpose — gameStore is the world (paws, territory, pets)
// and a re-render of it is expensive; connection health changes on a
// different clock and is read by exactly one small banner.
//
// TRACKS CONSECUTIVE FAILURES, NOT THE LAST ONE. A single failed sync is
// normal — a tunnel, a lift, a handover between masts — and a banner that
// flashed on every one of them would be noise people learn to ignore,
// which is worse than no banner. Two in a row is roughly thirty seconds
// of nothing working, which is worth telling somebody about.

import { create } from 'zustand';

const FAILURES_BEFORE_VISIBLE = 2;

export type ConnectionState = 'ok' | 'slow' | 'offline';

interface ConnectionStore {
  status: ConnectionState;
  consecutiveFailures: number;
  // Any successful call clears the whole thing. Recovery needs no
  // threshold — one response through means the network is back.
  noteSuccess: () => void;
  // `timedOut` distinguishes "we gave up waiting" from "it refused or the
  // network is gone", which is the difference between telling somebody
  // their connection is slow and telling them it is absent.
  noteFailure: (timedOut: boolean) => void;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  status: 'ok',
  consecutiveFailures: 0,

  noteSuccess: () => {
    // Guarded so a healthy app is not calling set() on every single
    // response — this fires on every sync, several times a minute.
    if (get().consecutiveFailures === 0 && get().status === 'ok') return;
    set({ status: 'ok', consecutiveFailures: 0 });
  },

  noteFailure: (timedOut) => {
    const n = get().consecutiveFailures + 1;
    set({
      consecutiveFailures: n,
      status: n < FAILURES_BEFORE_VISIBLE ? get().status : timedOut ? 'slow' : 'offline',
    });
  },
}));
