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
import { MODAL_PILL_DARK, MODAL_PILL_LIGHT } from '../../constants/buttons';
import { colors } from '../../constants/colors';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { SYSTEM_FONT } from '../../constants/fonts';
import { TYPE } from '../../constants/type';
import { HandDrawnFrame } from './HandDrawn';
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
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
        petName: petName.trim() || undefined,
        petBreed: breed.trim() || undefined,
      });
      setMe(r.me);
      if (wantsPassword) {
        await auth.changePassword(current, next);
        setCurrent('');
        setNext('');
        setPasswordOpen(false);
      }
      onSaved();
      setInfo(t.saved);
    });

  const logout = () =>
    run(async () => {
      await auth.logout();
      onLoggedOut();
    });

  // Escape closes, like every sheet in the app.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const title: CSSProperties = {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.body,
    fontWeight: 800,
    color: colors.black,
    margin: `${S.xs}px 0 0`,
  };

  return createPortal(
    <div style={OVERLAY}>
      <div
        style={{
          ...COLUMN,
          bottom: `calc(env(safe-area-inset-bottom, 0px) + ${S.m}px)`,
          maxHeight: visibleH - DOG_ROOM - S.m,
        }}
      >
        <div style={PAPER}>
          <HandDrawnFrame seed="edit" radius={R.card} />
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
            <Primary label={busy ? t.working : t.saveCta} disabled={busy || !canSave} onClick={save} />
            <div style={{ ...NOTE, display: 'flex', justifyContent: 'space-between', gap: S.m }}>
              <button type="button" style={LINK} onClick={onClose}>
                {t.done}
              </button>
              {isInTelegram() ? null : (
                <button type="button" style={{ ...LINK, color: colors.grey }} onClick={logout}>
                  {t.logout}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
