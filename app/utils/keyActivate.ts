import type { KeyboardEvent } from 'react';

// Enter and Space on a <div role="button"> (UX-14.2).
//
// tabIndex 0 lets a keyboard reach a div; nothing makes it activate one.
// A real <button> turns Enter and Space into a click on its own; a div
// has to be told. This does exactly that — clicks the element, so the
// one onClick it already has runs, pop and all — and nothing else.
//
// Only when the key landed on the element itself: a real control
// nested inside (a <button>, a link) activates natively and its click
// bubbles up on its own. Space's default is a page scroll, so it is
// cancelled.
export function clickOnKey(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target !== e.currentTarget) return;
  e.preventDefault();
  e.currentTarget.click();
}
