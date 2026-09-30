// The account, edited from the profile: the door's fields (nickname,
// the pet), a password change, and the way out — «вийти з акаунта» is
// a line at the bottom of this sheet, not a pill on the profile's sky.
// It used to be one, next to the language toggle, and it was both too
// big for what it does and, on the device that registered, did
// nothing (see services/api.ts logout).
//
// The same paper as the door (AccountDoor.tsx) — the styles and the
// field pieces are imported from there — opened from the small
// «змінити» chip on the dog card. No dog speaks here: the profile
// scene's dog has no bubble, so the sheet carries a one-line title.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, auth } from '../../services/api';
import { isInTelegram } from '../../services/telegram';
import { useAccessStore } from '../../stores/accessStore';
import { useStrings } from '../../i18n/useStrings';
import { useSheetBack } from '../../hooks/useSheetBack';
import { MODAL_PILL_DARK, MODAL_PILL_LIGHT } from '../../constants/buttons';
import { colors } from '../../constants/colors';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { SYSTEM_FONT } from '../../constants/fonts';
import { TYPE } from '../../constants/type';
import { HandDrawnFrame } from './HandDrawn';
import { AvatarStudio } from './AvatarStudio';
import {
  COLUMN,
  DOG_ROOM,
  ERROR,
  FIELD_INPUT,
  Field,
  LABEL,
  LINK,
  NOTE,
  OVERLAY,
  PAPER,
  Primary,
  SCROLL,
  useVisibleHeight,
} from './AccountDoor';

interface Props {
  onClose: () => void;
  // After a successful save: the profile re-reads its numbers and the
  // companion's name.
  onSaved: () => void;
  // After «вийти з акаунта»: the profile sends the person to the gate.
  onLoggedOut: () => void;
}

// The portrait on the edit row: a small round one like the profile
// card's, and like it without a drawn ring — the marker line is the
// edge.
const PORTRAIT_SIZE = 44;
const PORTRAIT: CSSProperties = {
  position: 'relative',
  width: PORTRAIT_SIZE,
  height: PORTRAIT_SIZE,
  flex: 'none',
  background: '#ffffff',
  borderRadius: '50%',
};

export function AccountEditSheet({ onClose, onSaved, onLoggedOut }: Props) {
  const t = useStrings().auth;
  const me = useAccessStore((s) => s.me);
  const setMe = useAccessStore((s) => s.setMe);
  const visibleH = useVisibleHeight();

  const [nickname, setNickname] = useState(me?.nickname ?? '');
  const [species, setSpecies] = useState<'dog' | 'cat' | null>(
    me?.pet?.species === 'dog' || me?.pet?.species === 'cat' ? me.pet.species : null,
  );
  const [petName, setPetName] = useState(me?.pet?.name ?? '');
  const [breed, setBreed] = useState(me?.pet?.breed ?? '');
  const [passwordOpen, setPasswordOpen] = useState(false);
  // The portrait studio takes the whole paper while it is open: it
  // has its own primary action, and two dark pills on one sheet is
  // one too many.
  const [studioOpen, setStudioOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [hidden, setHidden] = useState(me?.presenceHidden ?? false);

  // What the fields held when the sheet opened, or at the last save:
  // «done» and a tap outside the paper both close, and with unsaved
  // edits a close used to drop them without a word (UX-7.10). The
  // presence toggle is not in it — that one saves on the tap.
  const savedRef = useRef({ nickname, species, petName, breed });
  const sv = savedRef.current;
  const dirty =
    nickname !== sv.nickname ||
    species !== sv.species ||
    (species != null && (petName !== sv.petName || breed !== sv.breed)) ||
    current.length > 0 ||
    next.length > 0;
  // The first close with unsaved edits warns instead; the second one
  // means it. Any further edit re-arms the warning.
  const [discardArmed, setDiscardArmed] = useState(false);
  useEffect(() => {
    setDiscardArmed(false);
  }, [nickname, species, petName, breed, current, next]);
  // Logging out of an account that never registered is final: the
  // device id is rotated and nothing can log back into that row, so
  // its paws and history go with it (UX-1.13, D3). The first tap says
  // so; the second logs out. A registered account logs out on one tap
  // — the e-mail and password bring it back.
  const [logoutArmed, setLogoutArmed] = useState(false);
  const anonymous = !!me && !me.registered;

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

  const wantsPassword = passwordOpen && (current.length > 0 || next.length > 0);
  const canSave = nickname.trim().length >= 2 && (!wantsPassword || (current.length > 0 && next.length >= 8));

  const save = () =>
    run(async () => {
      const r = await auth.updateProfile({
        nickname,
        petSpecies: species ?? undefined,
        // Unticking the species removes the pet: the name and breed
        // left in the hidden fields are not sent with it (UX-1.12).
        petName: species ? petName.trim() || undefined : undefined,
        petBreed: species ? breed.trim() || undefined : undefined,
      });
      setMe(r.me);
      savedRef.current = { nickname, species, petName, breed };
      if (wantsPassword) {
        await auth.changePassword(current, next);
        setCurrent('');
        setNext('');
        setPasswordOpen(false);
      }
      onSaved();
      setInfo(t.saved);
    });

  // Persist on its own call — visibility is available to any signed-in
  // walker, not only a registered one, so it does not ride the profile save.
  const togglePresence = () =>
    run(async () => {
      const r = await auth.setPresenceHidden(!hidden);
      setHidden(r.me.presenceHidden);
      setMe(r.me);
    });

  const logout = () => {
    if (anonymous && !logoutArmed) {
      setLogoutArmed(true);
      return;
    }
    return run(async () => {
      await auth.logout();
      onLoggedOut();
    });
  };

  const removeAvatar = () =>
    run(async () => {
      const r = await auth.removeAvatar();
      setMe(r.me);
      onSaved();
    });

  const requestClose = () => {
    if (dirty && !discardArmed) {
      setDiscardArmed(true);
      return;
    }
    onClose();
  };

  // Back and Escape close it, as they now do every sheet (UX-2.5,
  // UX-14.1) — through the same unsaved-edits check as «done», so a
  // press with edits in the fields arms the discard line instead. Inert
  // while the portrait studio is open, like the backdrop below: a drawing
  // may be on its way, and the studio holds its own «later» for that.
  useSheetBack(true, () => {
    if (!studioOpen) requestClose();
  });

  // Form-sheet heading: TYPE.title, like the post reader (D16a,
  // UX-11.4). It was body size, so the sheet had no heading at all.
  const title: CSSProperties = {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.title,
    fontWeight: 700,
    color: colors.black,
    margin: `${S.xs}px 0 0`,
  };

  return createPortal(
    <div style={OVERLAY} role="dialog" aria-modal="true">
      {/* Tap outside the paper: close, as PlayerCard does (UX-7.10).
          Without it the profile stayed live behind the sheet. Inert
          while the portrait studio is open — it has its own ways out,
          and a drawing may be on its way. */}
      <div
        style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}
        onClick={() => {
          if (!studioOpen) requestClose();
        }}
      />
      <div
        style={{
          ...COLUMN,
          bottom: `calc(env(safe-area-inset-bottom, 0px) + ${S.m}px)`,
          // The measured height is taken at mount and does not follow
          // the keyboard; on Android and in Telegram the keyboard
          // shrinks the viewport instead of covering it, and a sheet
          // hung from the bottom at the old height went off the top
          // (UX-12.9). 100% is the overlay, which does shrink with it.
          maxHeight: `min(${visibleH - DOG_ROOM - S.m}px, calc(100% - ${DOG_ROOM + S.m}px - env(safe-area-inset-bottom, 0px)))`,
        }}
      >
        <div style={PAPER}>
          <HandDrawnFrame seed="edit" radius={R.card} />
          {studioOpen ? (
            <form style={SCROLL} onSubmit={(e) => e.preventDefault()}>
              <div style={title}>{t.avatarSection}</div>
              <AvatarStudio
                seed="edit"
                onClose={() => {
                  setStudioOpen(false);
                  onSaved();
                }}
              />
            </form>
          ) : (
          <form style={SCROLL} onSubmit={(e) => e.preventDefault()} autoComplete="on">
            <div style={title}>{t.editTitle}</div>

            <div style={LABEL}>{t.nicknameLabel}</div>
            <Field seed="edit-nick">
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
                  {species === sp ? null : <HandDrawnFrame seed={`edit-species-${sp}`} radius={R.button} />}
                  {sp === 'dog' ? t.speciesDog : t.speciesCat}
                </button>
              ))}
            </div>
            {species ? (
              <div style={{ display: 'flex', gap: S.s }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={LABEL}>{t.petNameLabel}</div>
                  <Field seed="edit-petname">
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
                  <Field seed="edit-breed">
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

            {me?.avatarConfigured ? (
              <>
                <div style={LABEL}>{t.avatarSection}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: S.m, marginTop: 4 }}>
                  {me.avatarUrl ? (
                    <div style={PORTRAIT}>
                      <div
                        role="img"
                        aria-label={t.avatarSection}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          borderRadius: '50%',
                          backgroundImage: `url("${me.avatarUrl}")`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center center',
                        }}
                      />
                    </div>
                  ) : null}
                  <button type="button" style={LINK} onClick={() => setStudioOpen(true)}>
                    {me.avatarUrl ? t.avatarEditRedraw : t.avatarEditDraw}
                  </button>
                  {me.avatarUrl ? (
                    <button type="button" style={{ ...LINK, color: colors.grey }} onClick={removeAvatar}>
                      {t.avatarEditRemove}
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}

            <div style={LABEL}>{t.presenceSection}</div>
            <div style={{ display: 'flex', gap: S.s, marginTop: 4 }}>
              {([false, true] as const).map((hv) => (
                <button
                  key={String(hv)}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (hidden !== hv) togglePresence();
                  }}
                  // Dimmed while a call is out (UX-9.3): the toggle saves on
                  // the tap, and a pill that looked live during that save
                  // got tapped again and did nothing.
                  style={{
                    ...(hidden === hv ? MODAL_PILL_DARK : MODAL_PILL_LIGHT),
                    opacity: busy ? 0.5 : 1,
                    cursor: busy ? 'default' : 'pointer',
                  }}
                >
                  {hidden === hv ? null : <HandDrawnFrame seed={`edit-presence-${hv}`} radius={R.button} />}
                  {hv ? t.presenceHiddenOption : t.presenceVisibleOption}
                </button>
              ))}
            </div>
            <div style={{ ...LABEL, color: colors.grey, marginTop: 4 }}>{t.presenceHint}</div>

            {me?.hasPassword ? (
              passwordOpen ? (
                <div style={{ display: 'flex', gap: S.s }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={LABEL}>{t.currentPasswordLabel}</div>
                    <Field seed="edit-current">
                      <input
                        value={current}
                        onChange={(e) => setCurrent(e.target.value)}
                        type="password"
                        autoComplete="current-password"
                        maxLength={200}
                        style={FIELD_INPUT}
                      />
                    </Field>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={LABEL}>{t.newPasswordLabel}</div>
                    <Field seed="edit-next">
                      <input
                        value={next}
                        onChange={(e) => setNext(e.target.value)}
                        placeholder={t.passwordPlaceholder}
                        type="password"
                        autoComplete="new-password"
                        maxLength={200}
                        style={FIELD_INPUT}
                      />
                    </Field>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: S.m }}>
                  <button type="button" style={LINK} onClick={() => setPasswordOpen(true)}>
                    {t.changePasswordLink}
                  </button>
                </div>
              )
            ) : null}

            {error ? <div style={ERROR}>{error}</div> : null}
            {info ? <div style={NOTE}>{info}</div> : null}
            {discardArmed && dirty ? <div style={ERROR}>{t.unsavedWarn}</div> : null}
            {logoutArmed ? <div style={ERROR}>{t.logoutAnonWarn}</div> : null}
            <Primary label={busy ? t.working : t.saveCta} disabled={busy || !canSave} onClick={save} />
            <div style={{ ...NOTE, display: 'flex', justifyContent: 'space-between', gap: S.m }}>
              <button type="button" style={LINK} onClick={requestClose}>
                {t.done}
              </button>
              {isInTelegram() ? null : (
                <button type="button" style={{ ...LINK, color: colors.grey }} onClick={() => void logout()}>
                  {logoutArmed ? t.logoutConfirm : t.logout}
                </button>
              )}
            </div>
          </form>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
