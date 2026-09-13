// The pet's portrait, drawn from a photo (D-72). One piece used in two
// places: the step after the door (AccountDoor, where the map's dog
// says the line for it) and the account sheet (AccountEditSheet, for
// drawing it later, again, or taking it down).
//
// Three states on the same paper: no photo yet (pick one), a photo
// picked (draw it, or pick another), a drawing back (keep it, try
// again with the same photo, or take it down). The photo is downscaled
// on the phone (services/photoFile.ts) and sent once; the server sends
// it to the model and keeps only the drawing, and the note under the
// pick button says exactly that.

import { useRef, useState, type CSSProperties } from 'react';
import { ApiError, auth } from '../../services/api';
import { fileToJpegBase64 } from '../../services/photoFile';
import { useAccessStore } from '../../stores/accessStore';
import { useStrings } from '../../i18n/useStrings';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { SURFACE } from '../../constants/surface';
import { HandDrawnFrame, PICTURE_INSET } from './HandDrawn';
import { ERROR, LINK, NOTE, Primary, Secondary } from './AccountDoor';

// The portrait is square (the model is asked for 1:1); the mount is
// the width of the register form's e-mail field, more or less.
const MOUNT = 148;
// A portrait is a small thing on screen; 1024 px is more than the
// model needs to see the animal and a tenth of a camera original.
const PHOTO_MAX_SIDE = 1024;

export type AvatarStage = 'ask' | 'done';

interface Props {
  // Frame seeds, so the two hosts draw different lines.
  seed: string;
  // The stage, for a host with a dog to say something about it.
  onStage?: (stage: AvatarStage) => void;
  // Keep, later, or none — every way out.
  onClose: () => void;
}

export function AvatarStudio({ seed, onStage, onClose }: Props) {
  const t = useStrings().auth;
  const setMe = useAccessStore((s) => s.setMe);
  const [photo, setPhoto] = useState<string | null>(null);
  // The drawing made in THIS studio session; an older one on the
  // account is not shown here, or «try again» would read as redraw
  // that one.
  const [drawn, setDrawn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const describe = (err: unknown): string => {
    if (err instanceof ApiError && err.code && t.errors[err.code]) return t.errors[err.code]!;
    if (err instanceof Error && (err.name === 'TimeoutError' || err.message.includes('Failed to fetch'))) {
      return t.errors.network!;
    }
    return t.errors.generic;
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPhoto(await fileToJpegBase64(file, PHOTO_MAX_SIDE));
      setDrawn(null);
      setError(null);
      onStage?.('ask');
    } catch {
      // Say so: a HEIC off an iPhone is the ordinary way here.
      setError(t.avatarUnreadable);
    }
  };

  const draw = async () => {
    if (!photo || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await auth.drawAvatar(photo);
      setMe(r.me);
      setDrawn(r.me.avatarUrl);
      onStage?.('done');
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await auth.removeAvatar();
      setMe(r.me);
      onClose();
    } catch (err) {
      setError(describe(err));
      setBusy(false);
    }
  };

  const shown = drawn ?? photo;
  const mount: CSSProperties = {
    position: 'relative',
    width: MOUNT,
    height: MOUNT,
    margin: `${S.s}px auto 0`,
    background: SURFACE.fill,
    borderRadius: R.chip,
    border: '2px solid transparent',
  };

  return (
    <>
      {shown ? (
        <div style={mount}>
          <HandDrawnFrame seed={`${seed}-portrait`} radius={R.chip} />
          {/* A div with a background, not an <img>: see LostFlowModal's
              photo mount for why an <img> bursts out of a sized box. */}
          <div
            role="img"
            aria-label={t.avatarSection}
            style={{
              position: 'absolute',
              inset: PICTURE_INSET,
              borderRadius: Math.max(0, R.chip - PICTURE_INSET),
              backgroundImage: `url("${shown}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center center',
              backgroundRepeat: 'no-repeat',
              // The drawing is on white paper already; the photo, before
              // it, fades to say it is not the thing being kept.
              opacity: drawn ? 1 : busy ? 0.5 : 1,
              transition: 'opacity 240ms ease',
            }}
          />
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          // So the same file can be picked again after «another photo».
          e.target.value = '';
        }}
      />

      {error ? <div style={ERROR}>{error}</div> : null}

      {!photo ? (
        <>
          <Primary label={t.avatarPick} onClick={() => fileInputRef.current?.click()} />
          <div style={NOTE}>{t.avatarPrivacy}</div>
          <div style={{ ...NOTE, textAlign: 'center' }}>
            <button type="button" style={LINK} onClick={onClose}>
              {t.avatarLater}
            </button>
          </div>
        </>
      ) : !drawn ? (
        <>
          <Primary label={busy ? t.avatarDrawing : t.avatarDraw} disabled={busy} onClick={() => void draw()} />
          <Secondary label={t.avatarChange} seed={`${seed}-change`} onClick={() => fileInputRef.current?.click()} />
          <div style={{ ...NOTE, textAlign: 'center' }}>
            <button type="button" style={LINK} onClick={onClose}>
              {t.avatarLater}
            </button>
          </div>
        </>
      ) : (
        <>
          <Primary label={t.avatarKeep} disabled={busy} onClick={onClose} />
          <Secondary label={busy ? t.avatarDrawing : t.avatarRetry} seed={`${seed}-retry`} onClick={() => void draw()} />
          <div style={{ ...NOTE, textAlign: 'center' }}>
            <button type="button" style={LINK} onClick={() => void remove()}>
              {t.avatarNone}
            </button>
          </div>
        </>
      )}
    </>
  );
}
