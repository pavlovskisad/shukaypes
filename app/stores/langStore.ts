// Persisted language preference for the app UI. Zustand `persist`
// middleware writes through to localStorage so the choice survives
// reloads. Kept separate from gameStore so its `persist` wiring
// doesn't have to take a side-effect on every game-state field.
//
// Initial value: UK for the Kyiv pilot — explicit override via the
// language toggle in profile (phase D). We intentionally do NOT
// auto-detect from Telegram's initDataUnsafe.user.language_code —
// same policy as the bot's getUserLang: the dog defaults to Kyiv-
// native unless the user opts out.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_LANG, type Lang } from '../i18n/strings';

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const useLangStore = create<LangState>()(
  persist(
    (set) => ({
      lang: DEFAULT_LANG,
      setLang: (lang) => set({ lang }),
    }),
    {
      name: 'shukajpes.lang',
      // Bail out gracefully when localStorage isn't available
      // (server-rendered preview / SSR snapshot pass). The store
      // still works in-memory; preference just doesn't persist.
      storage: createJSONStorage(() => {
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage;
        }
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        } as unknown as Storage;
      }),
    },
  ),
);
