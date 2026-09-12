// THE DOOR. Registration before the map, for everybody — D-69.
//
// Shown in place of the whole app while /auth/me says the account is
// not through: unregistered, or registered and waiting on the e-mail
// link. Five screens on one sheet of paper, because they are one
// conversation with the dog and not five pages:
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

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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
import { HandDrawnFrame } from './HandDrawn';
import { DogSprite } from '../map/DogSprite';

type Screen = 'register' | 'verify' | 'login' | 'forgot' | 'forgotSent' | 'reset';

const PAGE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  overflowY: 'auto',
  background: '#F3F0E7',
  fontFamily: SYSTEM_FONT,
  color: colors.black,
  WebkitOverflowScrolling: 'touch',
};

const COLUMN: CSSProperties = {
  maxWidth: 440,
  margin: '0 auto',
  padding: `${S.xl}px ${S.l}px ${S.huge}px`,
  boxSizing: 'border-box',
};

const PAPER: CSSProperties = {
  position: 'relative',
  background: SURFACE.fill,
  borderRadius: R.card,
  border: '2px solid transparent',
  boxShadow: SURFACE.lift,
  padding: S.l,
};

const FIELD_PAPER: CSSProperties = {
  position: 'relative',
  background: SURFACE.fill,
  borderRadius: R.chip,
  border: '2px solid transparent',
  marginTop: 4,
};

const FIELD_INPUT: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: SYSTEM_FONT,
  // 16px so iOS Safari does not zoom the viewport on focus.
  fontSize: 16,
  color: colors.black,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  padding: `${S.s}px ${S.m}px`,
  display: 'block',
};

const LABEL: CSSProperties = {
  fontFamily: SYSTEM_FONT,
  fontSize: TYPE.small,
  fontWeight: 700,
  color: colors.grey,
  margin: `${S.m}px 0 0`,
};

const LINK: CSSProperties = {
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

const ERROR: CSSProperties = {
  marginTop: S.m,
  fontSize: TYPE.small,
  fontWeight: 700,
  color: colors.red,
};

const NOTE: CSSProperties = {
  marginTop: S.m,
  fontSize: TYPE.small,
  color: colors.grey,
  lineHeight: 1.4,
};

function Field({ seed, children }: { seed: string; children: ReactNode }) {
  return (
    <div style={FIELD_PAPER}>
      <HandDrawnFrame seed={seed} radius={R.chip} />
      {children}
    </div>
  );
}

function Primary({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        if (!disabled) onClick();
      }}
      style={{ ...MODAL_PILL_DARK, width: '100%', marginTop: S.l, opacity: disabled ? 0.5 : 1, fontSize: TYPE.body }}
    >
      {label}
    </button>
  );
}

function Secondary({ label, seed, onClick }: { label: string; seed: string; onClick: () => void }) {
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

// The dog and its line, above the paper.
function Ask({ line }: { line: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: S.m, marginBottom: S.l }}>
      <div style={{ flexShrink: 0 }}>
        <DogSprite anim="sitting" facingLeft={false} scale={2} />
      </div>
      <div
        style={{
          position: 'relative',
          background: SURFACE.fill,
          borderRadius: R.card,
          border: '2px solid transparent',
          padding: `${S.m}px ${S.l}px`,
          fontSize: TYPE.body,
          lineHeight: 1.35,
          boxShadow: SURFACE.shadow,
        }}
      >
        <HandDrawnFrame seed="door-bubble" radius={R.card} />
        {line}
      </div>
    </div>
  );
}

function pickScreen(me: Me | null, resetToken: string | null, prefer: 'login' | null): Screen {
  if (resetToken) return 'reset';
  if (me?.door === 'verify') return 'verify';
  if (prefer === 'login') return 'login';
  return 'register';
}

// A legacy account's placeholder name is not a nickname anybody chose.
function suggestedNickname(me: Me | null): string {
  const n = me?.nickname ?? '';
  return /^walker-/.test(n) ? '' : n;
}

export function AccountDoor() {
  const t = useStrings().auth;
  const me = useAccessStore((s) => s.me);
  const setMe = useAccessStore((s) => s.setMe);
  const resetToken = useAccessStore((s) => s.resetToken);
  const setResetToken = useAccessStore((s) => s.setResetToken);
  const prefer = useAccessStore((s) => s.doorPrefer);
  const setDoorPrefer = useAccessStore((s) => s.setDoorPrefer);
  const notice = useAccessStore((s) => s.doorNotice);
  const setDoorNotice = useAccessStore((s) => s.setDoorNotice);

  const [screen, setScreen] = useState<Screen>(() => pickScreen(me, resetToken, prefer));
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

  const ask =
    screen === 'register'
      ? t.registerAsk
      : screen === 'verify'
        ? t.verifyAsk
        : screen === 'login'
          ? t.loginAsk
          : screen === 'reset'
            ? t.resetAsk
            : t.forgotAsk;

  return (
    <div style={PAGE}>
      <div style={COLUMN}>
        <Ask line={ask} />
        <form style={PAPER} onSubmit={(e) => e.preventDefault()} autoComplete="on">
          <HandDrawnFrame seed={`door-${screen}`} radius={R.card} />

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
                <>
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
                </>
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

              <label style={{ display: 'flex', gap: S.s, alignItems: 'flex-start', marginTop: S.l, cursor: 'pointer' }}>
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
  );
}
