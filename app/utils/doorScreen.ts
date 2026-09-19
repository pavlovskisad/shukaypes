// WHICH SCREEN THE DOOR OPENS ON.
//
// The dog asks «ми знайомі?» at the gate and the answer names a
// screen: «так, ти шо не впізнав?» opens login, «ні, давай
// познайомимось!» opens registration (Companion.tsx → openDoorSheet).
// Nothing else opens the sheet without naming what it wants — the
// reset link asks for 'reset', the portrait step for 'avatar'.
//
// THE BUG THIS FILE EXISTS FOR. When the door was built (D-69) it was
// not a sheet you asked for — it opened by itself, and `doorPrefer`
// was how the app said "after a logout this person wants to log in,
// not register again", because nobody had been asked. Then the gate's
// two answers arrived and `requested` was threaded through... above a
// `prefer === 'login'` line that was left where it was. From then on,
// for anybody who had logged out without reloading the page, tapping
// «ні, давай познайомимось!» opened LOGIN. Registration was not merely
// the wrong screen — it was unreachable, and unreachable for exactly
// the person who needed it, since the way out of a login screen is an
// account you do not have.
//
// Not persisted state, so a reload cleared it, which is why it read as
// "often" rather than "always".
//
// The rule now, and the reason this is a pure function with a fixture
// check (`pnpm check` in app/) rather than a condition inside the
// sheet: THE PERSON'S ANSWER WINS. Only the server's own state can
// override it — a reset token in hand, or an account that is waiting
// on its e-mail — because those are not preferences, they are where
// the account actually is.

export type DoorScreen =
  | 'register'
  | 'verify'
  | 'login'
  | 'forgot'
  | 'forgotSent'
  | 'reset'
  | 'avatar';

/** What the sheet was opened for. */
export type DoorSheet = 'register' | 'login' | 'verify' | 'reset' | 'avatar';

/** The slice of /auth/me this decision reads. */
export interface DoorMe {
  door: 'open' | 'register' | 'verify';
}

export function pickDoorScreen(
  requested: DoorSheet,
  me: DoorMe | null,
  resetToken: string | null,
): DoorScreen {
  // A link in hand beats everything: the person is here to set a new
  // password and cannot do anything else until they have.
  if (resetToken) return 'reset';
  // The account exists and is waiting on its letter. Asking it to
  // register again, or to log in, is asking for something that cannot
  // succeed.
  if (me?.door === 'verify') return 'verify';
  // The portrait is a step AFTER the door (D-72); asked for with the
  // door still shut, it is the door that shows.
  if (requested === 'avatar') return me?.door === 'open' ? 'avatar' : 'register';
  // 'reset' and 'verify' are only ever asked for alongside the state
  // that makes them meaningful, and both are handled above. Reaching
  // here means that state is gone — a spent link, a verified account —
  // so the sheet falls back to the screen everything starts from.
  if (requested === 'reset' || requested === 'verify') return 'register';
  return requested;
}
