// THE DOOR. Registration before the map, for everybody — D-69.
//
// A popup in the scene, not a page instead of it and not a dimmed
// modal over it. The dog asks «ми знайомі?» at the gate (Companion.tsx)
// and the answer opens this on login or registration; the map eases so
// the dog sits high on screen (MapView) and the paper takes the lower
// part, while the dog — the same dog, on the map — says the line for
// whichever screen is showing (doorScreen in the access store). When
// the account is through the sheet closes on its own and the dog is
// back at the gate with the four intents. Five screens on one sheet of
// paper, because they are one conversation with the dog and not five
// pages:
//
//   register   nickname, the pet (optional), e-mail, password, consent
//   verify     "the letter went to ol***@…" — check again, resend, fix
//   login      e-mail + password, for a person who already has one
//   forgot     e-mail → a reset link
//   reset      a new password, reached from that link
//
// Every screen is the same shape as the lost-pet form: white paper
// with a drawn edge, fields as paper inside paper, one dark pill for
// the answer that moves things forward. The dog sits above and says
// the line; the form is what it is asking for.
//
// Written against the DOM rather than RN primitives, like LostFlowModal
// and DogPrompt, because it is a form and RN-Web's TextInput has fought
// every form in this app. Web is the only shipped target.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, auth, type Me } from '../../services/api';
import { useAccessStore } from '../../stores/accessStore';
import { useStrings } from '../../i18n/useStrings';
import { MODAL_PILL_DARK, MODAL_PILL_LIGHT } from '../../constants/buttons';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { SURFACE } from '../../constants/surface';
import { TYPE } from '../../constants/type';
import { Z } from '../../constants/z';
import { HandDrawnFrame } from './HandDrawn';

type Screen = 'register' | 'verify' | 'login' | 'forgot' | 'forgotSent' | 'reset';

// The map stays as it is — no backdrop, no dimming, touches outside
// the paper reach the map. The paper hangs from the bottom edge and is
// AS TALL AS ITS FORM, up to what the dog needs above it (DOG_ROOM);
// it does not take a fixed share of the screen. A fixed half was the
// wrong shape both ways: the register form did not fit and scrolled,
// while the login form left a band of empty paper. Only a form taller
// than the room left scrolls, INSIDE the paper — the paper itself is
// not the scroll container, or its drawn edge scrolls away with the
// fields. The paper reports where its top edge is (doorSheetTop) and
// MapView frames the dog in the strip above it.
//
// MEASURED, NOT `vh`. On iOS Safari `vh` is the height with the
// toolbars hidden, so a share of it was more than the same share of
// what is actually visible and the paper's top landed on the dog.
// `window.innerHeight` is the visible height. Read at mount and on
// orientation change — not on every resize, or the keyboard opening
// would shrink the paper under the person's thumb.
export const OVERLAY: CSSProperties = {
  position: 'fixed',
  inset: 0,
  pointerEvents: 'none',
  fontFamily: SYSTEM_FONT,
  color: colors.black,
  zIndex: Z.MODAL_GLOBAL,
};

export const COLUMN: CSSProperties = {
  position: 'absolute',
  left: S.m,
  right: S.m,
  bottom: `calc(env(safe-area-inset-bottom, 0px) + ${S.m}px)`,
  maxWidth: 440,
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column',
  pointerEvents: 'auto',
};

// What the dog needs above the paper, in px of the visible height: its
// centre no higher than DOG_MIN_Y (the three-line bubble above it has
// to stay on screen — measured on an iPhone: bubble top is ~130 px
// above the dog's centre), the drawn dog's lower half (~30 px) and a
// gap to the paper's edge. MapView uses DOG_MIN_Y for the same framing.
export const DOG_MIN_Y = 150;
export const DOG_ROOM = DOG_MIN_Y + 40;

export function useVisibleHeight(): number {
  const [h, setH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => setH(window.innerHeight);
    window.addEventListener('orientationchange', on);
    return () => window.removeEventListener('orientationchange', on);
  }, []);
  return h;
}

export const PAPER: CSSProperties = {
  position: 'relative',
  background: SURFACE.fill,
  borderRadius: R.card,
  border: '2px solid transparent',
  boxShadow: SURFACE.lift,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
};

// What scrolls (only when it must): the form, inside the paper, under
// the drawn edge. Tight rhythm on purpose — every 4 px here is 4 px of
// map above the paper, and the register form with a pet named has six
// fields to fit.
export const SCROLL: CSSProperties = {
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  minHeight: 0,
  padding: `${S.s}px ${S.l}px ${S.m}px`,
};

const FIELD_PAPER: CSSProperties = {
  position: 'relative',
  background: SURFACE.fill,
  borderRadius: R.chip,
  border: '2px solid transparent',
  marginTop: 4,
};

export const FIELD_INPUT: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: SYSTEM_FONT,
  // 16px so iOS Safari does not zoom the viewport on focus.
  fontSize: 16,
  color: colors.black,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  padding: `6px ${S.m}px`,
  display: 'block',
};

export const LABEL: CSSProperties = {
  fontFamily: SYSTEM_FONT,
  fontSize: TYPE.small,
  fontWeight: 700,
  color: colors.grey,
  margin: `${S.s}px 0 0`,
};

export const LINK: CSSProperties = {
  appearance: 'none',
  background: 'none',
  border: 'none',
  padding: 0,
  fontFamily: SYSTEM_FONT,
  fontSize: TYPE.small,
  fontWeight: 700,
  color: colors.black,
  textDecoration: 'underline',
  cursor: 'pointer',
};

export const ERROR: CSSProperties = {
  marginTop: S.m,
  fontSize: TYPE.small,
  fontWeight: 700,
  color: colors.red,
};

export const NOTE: CSSProperties = {
  marginTop: S.s,
  fontSize: TYPE.small,
  color: colors.grey,
  lineHeight: 1.4,
};

export function Field({ seed, children }: { seed: string; children: ReactNode }) {
  return (
    <div style={FIELD_PAPER}>
      <HandDrawnFrame seed={seed} radius={R.chip} />
      {children}
    </div>
  );
}

export function Primary({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        if (!disabled) onClick();
      }}
      style={{ ...MODAL_PILL_DARK, width: '100%', marginTop: S.m, opacity: disabled ? 0.5 : 1, fontSize: TYPE.body }}
    >
      {label}
    </button>
  );
}

export function Secondary({ label, seed, onClick }: { label: string; seed: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...MODAL_PILL_LIGHT, width: '100%', marginTop: S.s, fontSize: TYPE.body }}
    >
      <HandDrawnFrame seed={seed} radius={R.button} />
      {label}
    </button>
  );
}

function pickScreen(
  requested: 'register' | 'login' | 'verify' | 'reset',
  me: Me | null,
  resetToken: string | null,
  prefer: 'login' | null,
): Screen {
  if (resetToken) return 'reset';
  if (me?.door === 'verify') return 'verify';
  if (requested === 'reset' || requested === 'verify') return 'register';
  if (prefer === 'login') return 'login';
  return requested;
}

// The placeholder a row gets on first contact is not a nickname anybody chose.
function suggestedNickname(me: Me | null): string {
  const n = me?.nickname ?? '';
  return /^walker-/.test(n) ? '' : n;
}

export function AccountDoor() {
  const sheet = useAccessStore((s) => s.doorSheet);
  if (!sheet) return null;
  return <AccountSheet requested={sheet} />;
}

function AccountSheet({ requested }: { requested: 'register' | 'login' | 'verify' | 'reset' }) {
  const t = useStrings().auth;
  const me = useAccessStore((s) => s.me);
  const setMe = useAccessStore((s) => s.setMe);
  const resetToken = useAccessStore((s) => s.resetToken);
  const setResetToken = useAccessStore((s) => s.setResetToken);
  const prefer = useAccessStore((s) => s.doorPrefer);
  const setDoorPrefer = useAccessStore((s) => s.setDoorPrefer);
  const notice = useAccessStore((s) => s.doorNotice);
  const setDoorNotice = useAccessStore((s) => s.setDoorNotice);

  const [screen, setScreen] = useState<Screen>(() => pickScreen(requested, me, resetToken, prefer));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(notice ? (t[notice as keyof typeof t] as string) ?? null : null);

  // Fields. One bag for every screen; only the relevant ones render.
  const [nickname, setNickname] = useState(() => suggestedNickname(me));
  const [species, setSpecies] = useState<'dog' | 'cat' | null>(
    me?.pet?.species === 'dog' || me?.pet?.species === 'cat' ? me.pet.species : null,
  );
  const [petName, setPetName] = useState(me?.pet?.name ?? '');
  const [breed, setBreed] = useState(me?.pet?.breed ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);

  // If /auth/me changes under us (a registration landed from another
  // tab, a nudge re-read it), follow the TRANSITION into 'verify' —
  // not the state, or «fix the e-mail» could never leave that screen.
  const door = me?.door ?? null;
  const [seenDoor, setSeenDoor] = useState(door);
  useEffect(() => {
    if (door !== seenDoor) {
      setSeenDoor(door);
      if (door === 'verify') setScreen('verify');
    }
  }, [door, seenDoor]);

  useEffect(() => {
    if (notice) setDoorNotice(null);
  }, [notice, setDoorNotice]);

  const describe = (err: unknown): string => {
    if (err instanceof ApiError && err.code && t.errors[err.code]) return t.errors[err.code]!;
    if (err instanceof Error && (err.name === 'TimeoutError' || err.message.includes('Failed to fetch'))) {
      return t.errors.network!;
    }
    return t.errors.generic;
  };

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await work();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  };

  const go = (next: Screen) => {
    setError(null);
    setInfo(null);
    setScreen(next);
  };

  const register = () =>
    run(async () => {
      const r = await auth.register({
        nickname,
        email,
        password,
        consent: true,
        petSpecies: species ?? undefined,
        petName: petName.trim() || undefined,
        petBreed: breed.trim() || undefined,
      });
      setMe(r.me);
      if (r.me.door === 'verify') {
        setScreen('verify');
        if (!r.emailSent) setInfo(t.verifyNotSent);
      }
    });

  const login = () =>
    run(async () => {
      const m = await auth.login(email, password);
      setDoorPrefer(null);
      setMe(m);
      if (m.door === 'verify') setScreen('verify');
    });

  const forgot = () =>
    run(async () => {
      await auth.forgot(email);
      setScreen('forgotSent');
    });

  const reset = () =>
    run(async () => {
      if (!resetToken) return;
      const m = await auth.reset(resetToken, password);
      setResetToken(null);
      setMe(m);
    });

  const checkVerified = () =>
    run(async () => {
      const m = await auth.me();
      setMe(m);
      if (m.door !== 'open') setInfo(t.verifyStillNot);
    });

  const resend = () =>
    run(async () => {
      const r = await auth.resend();
      setInfo(r.emailSent ? t.verifyResent : t.verifyNotSent);
    });

  const logoutToLogin = () =>
    run(async () => {
      await auth.logout();
      const m = await auth.me().catch(() => null);
      setMe(m);
      setScreen('login');
    });

  const consentOk = consent;
  const canRegister = nickname.trim().length >= 2 && email.includes('@') && password.length >= 8 && consentOk;

  const visibleH = useVisibleHeight();
  // The dog on the map says the line for this screen (Companion.tsx).
  const setDoorScreen = useAccessStore((s) => s.setDoorScreen);
  useEffect(() => {
    setDoorScreen(screen);
  }, [screen, setDoorScreen]);

  // Where the paper's top edge is, for the camera. Observed rather than
  // computed: the paper is as tall as its form, and the form changes
  // height on its own (a pet named adds a row, an error adds a line).
  const paperRef = useRef<HTMLDivElement>(null);
  const setDoorSheetTop = useAccessStore((s) => s.setDoorSheetTop);
  useEffect(() => {
    const el = paperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const report = () => setDoorSheetTop(Math.round(el.getBoundingClientRect().top));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => {
      ro.disconnect();
      setDoorSheetTop(null);
    };
  }, [setDoorSheetTop]);

  return createPortal(
    <div style={OVERLAY}>
      <div style={{ ...COLUMN, maxHeight: visibleH - DOG_ROOM - S.m }}>
        <div style={PAPER} ref={paperRef}>
          <HandDrawnFrame seed={`door-${screen}`} radius={R.card} />
          <form style={SCROLL} onSubmit={(e) => e.preventDefault()} autoComplete="on">

          {screen === 'register' ? (
            <>
              <div style={LABEL}>{t.nicknameLabel}</div>
              <Field seed="nick">
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder={t.nicknamePlaceholder}
                  maxLength={24}
                  autoComplete="nickname"
                  style={FIELD_INPUT}
                />
              </Field>

              <div style={LABEL}>{t.petSection}</div>
              <div style={{ display: 'flex', gap: S.s, marginTop: 4 }}>
                {(['dog', 'cat'] as const).map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => setSpecies(species === sp ? null : sp)}
                    style={species === sp ? MODAL_PILL_DARK : MODAL_PILL_LIGHT}
                  >
                    {species === sp ? null : <HandDrawnFrame seed={`species-${sp}`} radius={R.button} />}
                    {sp === 'dog' ? t.speciesDog : t.speciesCat}
                  </button>
                ))}
              </div>
              {species ? (
                // Name and breed side by side: one row, not two, so the
                // form still fits above the dog once a pet is named.
                <div style={{ display: 'flex', gap: S.s }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={LABEL}>{t.petNameLabel}</div>
                    <Field seed="petname">
                      <input
                        value={petName}
                        onChange={(e) => setPetName(e.target.value)}
                        placeholder={t.petNamePlaceholder}
                        maxLength={40}
                        style={FIELD_INPUT}
                      />
                    </Field>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={LABEL}>{t.breedLabel}</div>
                    <Field seed="breed">
                      <input
                        value={breed}
                        onChange={(e) => setBreed(e.target.value)}
                        placeholder={t.breedPlaceholder}
                        maxLength={60}
                        style={FIELD_INPUT}
                      />
                    </Field>
                  </div>
                </div>
              ) : null}

              <div style={LABEL}>{t.emailLabel}</div>
              <Field seed="email">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  maxLength={254}
                  style={FIELD_INPUT}
                />
              </Field>

              <div style={LABEL}>{t.passwordLabel}</div>
              <Field seed="password">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t.passwordPlaceholder}
                  type="password"
                  autoComplete="new-password"
                  maxLength={200}
                  style={FIELD_INPUT}
                />
              </Field>

              <label style={{ display: 'flex', gap: S.s, alignItems: 'flex-start', marginTop: S.m, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  style={{ marginTop: 3, width: 18, height: 18, accentColor: colors.black }}
                />
                <span style={{ fontSize: TYPE.small, lineHeight: 1.4, color: colors.grey }}>{t.consent}</span>
              </label>

              {error ? <div style={ERROR}>{error}</div> : null}
              <Primary label={busy ? t.working : t.registerCta} disabled={busy || !canRegister} onClick={register} />
              <div style={{ ...NOTE, textAlign: 'center' }}>
                {t.haveAccount}{' '}
                <button type="button" style={LINK} onClick={() => go('login')}>
                  {t.loginCta}
                </button>
              </div>
            </>
          ) : null}

          {screen === 'verify' ? (
            <>
              <div style={{ fontSize: TYPE.body, lineHeight: 1.4 }}>{t.verifySent(me?.email ?? '…')}</div>
              {info ? <div style={NOTE}>{info}</div> : null}
              {error ? <div style={ERROR}>{error}</div> : null}
              <Primary label={busy ? t.working : t.verifyCheck} disabled={busy} onClick={checkVerified} />
              <Secondary label={t.verifyResend} seed="resend" onClick={resend} />
              <div style={{ ...NOTE, display: 'flex', flexDirection: 'column', gap: S.s, alignItems: 'center' }}>
                <button type="button" style={LINK} onClick={() => go('register')}>
                  {t.verifyFixEmail}
                </button>
                <button type="button" style={LINK} onClick={logoutToLogin}>
                  {t.otherAccount}
                </button>
              </div>
            </>
          ) : null}

          {screen === 'login' ? (
            <>
              <div style={LABEL}>{t.emailLabel}</div>
              <Field seed="login-email">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  maxLength={254}
                  style={FIELD_INPUT}
                />
              </Field>
              <div style={LABEL}>{t.passwordLabel}</div>
              <Field seed="login-password">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete="current-password"
                  maxLength={200}
                  style={FIELD_INPUT}
                />
              </Field>
              {info ? <div style={NOTE}>{info}</div> : null}
              {error ? <div style={ERROR}>{error}</div> : null}
              <Primary
                label={busy ? t.working : t.loginCta}
                disabled={busy || !email.includes('@') || password.length === 0}
                onClick={login}
              />
              <div style={{ ...NOTE, display: 'flex', justifyContent: 'space-between' }}>
                <button type="button" style={LINK} onClick={() => go('forgot')}>
                  {t.forgotLink}
                </button>
                <span>
                  {t.noAccount}{' '}
                  <button type="button" style={LINK} onClick={() => go('register')}>
                    {t.registerCta}
                  </button>
                </span>
              </div>
            </>
          ) : null}

          {screen === 'forgot' ? (
            <>
              <div style={LABEL}>{t.emailLabel}</div>
              <Field seed="forgot-email">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  maxLength={254}
                  style={FIELD_INPUT}
                />
              </Field>
              {error ? <div style={ERROR}>{error}</div> : null}
              <Primary label={busy ? t.working : t.forgotCta} disabled={busy || !email.includes('@')} onClick={forgot} />
              <div style={{ ...NOTE, textAlign: 'center' }}>
                <button type="button" style={LINK} onClick={() => go('login')}>
                  {t.backToLogin}
                </button>
              </div>
            </>
          ) : null}

          {screen === 'forgotSent' ? (
            <>
              <div style={{ fontSize: TYPE.body, lineHeight: 1.4 }}>{t.forgotSent}</div>
              <Secondary label={t.backToLogin} seed="back" onClick={() => go('login')} />
            </>
          ) : null}

          {screen === 'reset' ? (
            <>
              <div style={LABEL}>{t.newPasswordLabel}</div>
              <Field seed="reset-password">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t.passwordPlaceholder}
                  type="password"
                  autoComplete="new-password"
                  maxLength={200}
                  style={FIELD_INPUT}
                />
              </Field>
              {error ? <div style={ERROR}>{error}</div> : null}
              <Primary label={busy ? t.working : t.resetCta} disabled={busy || password.length < 8} onClick={reset} />
              <div style={{ ...NOTE, textAlign: 'center' }}>
                <button
                  type="button"
                  style={LINK}
                  onClick={() => {
                    setResetToken(null);
                    go('login');
                  }}
                >
                  {t.backToLogin}
                </button>
              </div>
            </>
          ) : null}
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
