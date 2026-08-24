// "I lost my pet" — the answer to the top of the ring.
//
// A real form now, not a signpost. The server half (POST /dogs/report)
// takes structured fields, the owner's OWN pin, and a photo — no model
// guessing anywhere: the pet lands on the map instantly with
// placement_source 'owner', the post is crossposted to our channel and
// the wired district groups, and the app owner gets an expire control.
//
// THE PIN STEP borrows the map instead of embedding one. The store
// already tracks viewportCenter (set by MapView on idle), so "point at
// the place" is: hide this sheet, draw a crosshair over the map's
// centre, let the person pan the map underneath it, and read
// viewportCenter on confirm. No second map, no MapView surgery.
//
// THE PHOTO is downscaled client-side (canvas, longest side 1600px,
// JPEG) before travelling as base64 — a phone camera original is
// 5–12MB; after this it is ~200–400KB, well inside the route's body
// limit, and the upload happens inside the report request itself.
//
// The bot-DM path survives as the secondary line: it works today, suits
// Telegram natives, and is the fallback for anything the form can't
// hold. An empty bot link degrades to no line at all — a dead CTA is
// worse than no CTA.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Z } from '../../constants/z';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { MODAL_PILL_DARK, MODAL_PILL_LIGHT } from '../../constants/buttons';
import { env } from '../../constants/env';
import { openTelegramChat } from '../../services/telegram';
import { api } from '../../services/api';
import { useGameStore } from '../../stores/gameStore';
import { SURFACE } from '../../constants/surface';
import { useStrings } from '../../i18n/useStrings';
import { HandDrawnFrame } from './HandDrawn';

// Same figure PostModal / SpotModal / LostDogModal use, so all four sheets
// open and close on one clock.
const SHEET_ANIM_MS = 280;

// Longest side after downscale. 1600px keeps a dog recognisable on any
// screen this app renders while cutting a camera original ~30-fold.
const PHOTO_MAX_SIDE = 1600;
const PHOTO_JPEG_QUALITY = 0.82;

type Step = 'form' | 'pin' | 'done';

interface LostFlowModalProps {
  open: boolean;
  onClose: () => void;
}

const FIELD_STYLE: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: SYSTEM_FONT,
  fontSize: TYPE.body,
  color: '#2B2B26',
  background: '#F7F5EE',
  border: '1px solid #DDD8C9',
  borderRadius: R.chip,
  padding: `${S.s}px ${S.m}px`,
  outline: 'none',
};

const LABEL_STYLE: React.CSSProperties = {
  fontFamily: SYSTEM_FONT,
  fontSize: TYPE.small,
  fontWeight: 700,
  color: '#5A5750',
  margin: `${S.m}px 0 4px`,
};

// File → downscaled JPEG data URL. createImageBitmap where the browser
// has it (it decodes off the main thread), <img> decode as fallback.
async function fileToJpegBase64(file: File): Promise<string> {
  let width: number;
  let height: number;
  let source: CanvasImageSource;
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    width = bmp.width;
    height = bmp.height;
    source = bmp;
  } else {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      width = img.naturalWidth;
      height = img.naturalHeight;
      source = img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY);
}

export function LostFlowModal({ open, onClose }: LostFlowModalProps) {
  const t = useStrings();
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  const [step, setStep] = useState<Step>('form');
  const [species, setSpecies] = useState<'dog' | 'cat'>('dog');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [phone, setPhone] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ channelPostUrl: string | null; photoStored: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // The three-state open/closing/unmount dance shared by the modal
  // family — the sheet has to outlive `open` long enough to animate out.
  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (rendered && !closing) {
      setClosing(true);
      const timer = setTimeout(() => {
        setRendered(false);
        setClosing(false);
        // A finished (or abandoned) flow starts fresh next time; a pet
        // is not usually lost twice in one session.
        setStep('form');
        setError(null);
        setSending(false);
        setResult(null);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!rendered) return null;
  if (typeof document === 'undefined') return null;

  const s = t.modes.lostSheet;
  const botUrl = env.telegramBotUrl;

  const onPickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPhotoDataUrl(await fileToJpegBase64(file));
      setError(null);
    } catch {
      setPhotoDataUrl(null);
    }
  };

  const submit = async () => {
    if (desc.trim().length < 10) {
      setError(s.errShort);
      return;
    }
    if (!pin) {
      setError(s.errNoPin);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const r = await api.reportLostPet({
        species,
        name: name.trim() || undefined,
        description: desc.trim(),
        lat: pin.lat,
        lng: pin.lng,
        contactPhone: phone.trim() || undefined,
        photoBase64: photoDataUrl ?? undefined,
      });
      setResult({ channelPostUrl: r.channelPostUrl, photoStored: r.photoStored });
      setStep('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg.includes('429') ? s.errLimit : s.errGeneric);
    } finally {
      setSending(false);
    }
  };

  // ---- PIN MODE: the map does the work, we draw two things over it ----
  if (step === 'pin') {
    return createPortal(
      <>
        {/* Crosshair over the map's centre. pointerEvents: none — the
            map underneath must keep every gesture. */}
        <div
          style={{
            position: 'fixed',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -100%)',
            zIndex: Z.MODAL_GLOBAL,
            pointerEvents: 'none',
            fontSize: 40,
            lineHeight: 1,
            filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.35))',
          }}
        >
          📍
        </div>
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: `calc(env(safe-area-inset-bottom, 0px) + 92px)`,
            transform: 'translateX(-50%)',
            zIndex: Z.MODAL_GLOBAL,
            width: 'min(92vw, 420px)',
            background: '#ffffff',
            borderRadius: R.card,
            boxShadow: SURFACE.lift,
            padding: S.m,
          }}
        >
          <HandDrawnFrame radius={R.card} />
          <div
            style={{
              fontFamily: SYSTEM_FONT,
              fontSize: TYPE.small,
              lineHeight: 1.4,
              color: '#2B2B26',
              marginBottom: S.s,
              textAlign: 'center',
            }}
          >
            {s.pinHint}
          </div>
          <div style={{ display: 'flex', gap: S.s }}>
            <button onClick={() => setStep('form')} style={MODAL_PILL_LIGHT}>
              <HandDrawnFrame radius={R.button} />
              {s.pinBack}
            </button>
            <button
              onClick={() => {
                const { viewportCenter, userPosition } = useGameStore.getState();
                const center = viewportCenter ?? userPosition;
                if (center) {
                  setPin({ lat: center.lat, lng: center.lng });
                  setError(null);
                }
                setStep('form');
              }}
              style={MODAL_PILL_DARK}
            >
              {s.pinConfirm}
            </button>
          </div>
        </div>
      </>,
      document.body,
    );
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,20,15,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        // See the geometry note in HandDrawn.tsx: the sheet hangs under
        // the safe-area inset as a poster with four visible edges.
        padding: 'calc(env(safe-area-inset-top, 0px) + 8px) 10px 0',
        boxSizing: 'border-box',
        justifyContent: 'center',
        zIndex: Z.MODAL_GLOBAL,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: R.card,
          width: '100%',
          maxWidth: 460,
          maxHeight: 'calc(100vh - 118px - env(safe-area-inset-top) - env(safe-area-inset-bottom))' as unknown as number,
          display: 'flex',
          flexDirection: 'column',
          animation: `top-sheet-${closing ? 'out' : 'in'} ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`,
          boxShadow: SURFACE.lift,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <HandDrawnFrame radius={R.card} />
        <div style={{ padding: `${S.l}px ${S.l}px ${S.s}px`, flexShrink: 0 }}>
          <div
            style={{
              fontFamily: SYSTEM_FONT,
              fontSize: TYPE.title,
              fontWeight: 800,
              color: '#2B2B26',
            }}
          >
            {step === 'done' ? s.doneTitle : s.title}
          </div>
        </div>

        <div style={{ padding: `0 ${S.l}px ${S.m}px`, overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {step === 'done' && result ? (
            <div style={{ fontFamily: SYSTEM_FONT, fontSize: TYPE.body, lineHeight: 1.5, color: '#2B2B26' }}>
              {s.doneBody}
              {!result.photoStored && photoDataUrl ? (
                <div style={{ marginTop: S.s, fontSize: TYPE.small, color: '#5A5750' }}>{s.doneNoPhoto}</div>
              ) : null}
            </div>
          ) : (
            <>
              {/* species */}
              <div style={{ display: 'flex', gap: S.s }}>
                {(['dog', 'cat'] as const).map((sp) => (
                  <button
                    key={sp}
                    onClick={() => setSpecies(sp)}
                    style={{
                      ...FIELD_STYLE,
                      cursor: 'pointer',
                      textAlign: 'center',
                      fontWeight: species === sp ? 800 : 400,
                      background: species === sp ? '#EBE7D9' : '#F7F5EE',
                      borderColor: species === sp ? '#2B2B26' : '#DDD8C9',
                    }}
                  >
                    {sp === 'dog' ? s.speciesDog : s.speciesCat}
                  </button>
                ))}
              </div>

              <div style={LABEL_STYLE}>{s.nameLabel}</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={s.namePlaceholder}
                maxLength={60}
                style={FIELD_STYLE}
              />

              <div style={LABEL_STYLE}>{s.descLabel}</div>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder={s.descPlaceholder}
                maxLength={1500}
                rows={4}
                style={{ ...FIELD_STYLE, resize: 'vertical', minHeight: 88 }}
              />

              <div style={LABEL_STYLE}>{s.phoneLabel}</div>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={s.phonePlaceholder}
                maxLength={30}
                inputMode="tel"
                style={FIELD_STYLE}
              />

              {/* photo + pin — the two buttons that gather the non-text facts */}
              <div style={{ display: 'flex', gap: S.s, marginTop: S.m }}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{ ...FIELD_STYLE, cursor: 'pointer', textAlign: 'center' }}
                >
                  {photoDataUrl ? s.photoChange : s.photoLabel}
                </button>
                <button
                  onClick={() => setStep('pin')}
                  style={{
                    ...FIELD_STYLE,
                    cursor: 'pointer',
                    textAlign: 'center',
                    fontWeight: pin ? 800 : 400,
                    borderColor: pin ? '#2B2B26' : '#DDD8C9',
                  }}
                >
                  {pin ? s.pinPicked : s.pickPin}
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => void onPickPhoto(e.target.files?.[0])}
              />
              {photoDataUrl ? (
                <img
                  src={photoDataUrl}
                  alt=""
                  style={{
                    marginTop: S.s,
                    width: '100%',
                    maxHeight: 140,
                    objectFit: 'cover',
                    borderRadius: R.chip,
                  }}
                />
              ) : null}

              {error ? (
                <div
                  style={{
                    marginTop: S.m,
                    padding: S.s,
                    borderRadius: R.chip,
                    background: '#F9E9E4',
                    fontFamily: SYSTEM_FONT,
                    fontSize: TYPE.small,
                    color: '#8C3A2B',
                  }}
                >
                  {error}
                </div>
              ) : null}

              {botUrl ? (
                <div
                  style={{
                    marginTop: S.m,
                    fontFamily: SYSTEM_FONT,
                    fontSize: TYPE.small,
                    lineHeight: 1.45,
                    color: '#5A5750',
                  }}
                >
                  {s.botLine}{' '}
                  <a
                    onClick={(e) => {
                      e.preventDefault();
                      openTelegramChat(botUrl);
                    }}
                    href={botUrl}
                    style={{ color: '#2B2B26', fontWeight: 700, cursor: 'pointer' }}
                  >
                    {s.botCta}
                  </a>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: S.s,
            padding: `${S.s}px ${S.l}px calc(${S.l}px + env(safe-area-inset-bottom, 0px))`,
            flexShrink: 0,
          }}
        >
          {step === 'done' && result ? (
            <>
              {result.channelPostUrl ? (
                <button
                  onClick={() =>
                    openTelegramChat(
                      `https://t.me/share/url?url=${encodeURIComponent(result.channelPostUrl!)}`,
                    )
                  }
                  style={MODAL_PILL_DARK}
                >
                  {s.doneShare}
                </button>
              ) : null}
              <button onClick={onClose} style={MODAL_PILL_LIGHT}>
                <HandDrawnFrame radius={R.button} />
                {s.doneClose}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => void submit()} disabled={sending} style={{ ...MODAL_PILL_DARK, opacity: sending ? 0.6 : 1 }}>
                {sending ? s.submitting : s.submit}
              </button>
              <button onClick={onClose} style={MODAL_PILL_LIGHT}>
                <HandDrawnFrame radius={R.button} />
                {s.close}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
