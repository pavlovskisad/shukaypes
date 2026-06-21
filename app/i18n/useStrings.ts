// Strings hook + non-React accessor. Components reading strings in
// JSX use useStrings(); callbacks / actions / non-component code that
// can't call a hook use getStrings() which reads the same store.
//
// Both return the AppStrings record for the active language. Switch
// language anywhere (profile toggle, bot-side mirror handler, future
// /lang command) by calling useLangStore.getState().setLang('en').

import { useLangStore } from '../stores/langStore';
import { strings, type AppStrings } from './strings';

export function useStrings(): AppStrings {
  const lang = useLangStore((s) => s.lang);
  return strings[lang];
}

export function getStrings(): AppStrings {
  return strings[useLangStore.getState().lang];
}
