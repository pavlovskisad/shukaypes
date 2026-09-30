// "I lost my pet" — the answer to the top of the ring.
//
// A real form now, not a signpost. The server half (POST /dogs/report)
// takes structured fields, the owner's OWN pin, and a photo — no model
// guessing anywhere: the pet lands on the map instantly with
// placement_source 'owner', the post is crossposted to our channel and
// the wired district groups, and the app owner gets an expire control.
//
// THE PIN STEP borrows the map instead of embedding one: hide this
// sheet, draw a crosshair over the middle of the window, let the person
// pan the map underneath it, and on confirm ask MapView for the point
// under that exact pixel (readScreenCenter). No second map. It used to
// read viewportCenter — the midpoint of the map's bounds — which on a
// tilted camera is a street or more up-screen of the crosshair (UX-1.4).
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
import { MODAL_PILL_DARK, MODAL_PILL_DISABLED, MODAL_PILL_LIGHT } from '../../constants/buttons';
import { env } from '../../constants/env';
import { openTelegramChat, setTelegramClosingConfirmation } from '../../services/telegram';
import { useSheetBack } from '../../hooks/useSheetBack';
import { api } from '../../services/api';
import { fileToJpegBase64 } from '../../services/photoFile';
import { readScreenCenter, useGameStore } from '../../stores/gameStore';
import { SURFACE } from '../../constants/surface';
import { useStrings } from '../../i18n/useStrings';
import { HandDrawnFrame, PAPER_EDGE } from './HandDrawn';
import { Icon } from './Icon';
import { colors } from '../../constants/colors';
import { INLINE_ICON } from '../../constants/sizing';
import { MOTION } from '../../utils/motion';
import { playPop, playPopThen } from '../../utils/popOnTap';

// Same figure PostModal / SpotModal / LostDogModal use, so all four sheets
// open and close on one clock.
const SHEET_ANIM_MS = MOTION.sheetMs;

// How far the picture sits inside its mount: the paper margin the drawn
// line is measured from, plus the line. Same figure, same name, as the
// pet card — white, then the line, then the picture.
const PHOTO_INSET = PAPER_EDGE + 2;


type Step = 'form' | 'pin' | 'done';

interface LostFlowModalProps {
  open: boolean;
  onClose: () => void;
}

// ── PAPER AND INK, HERE TOO ─────────────────────────────────────────
//
// The form shipped in the material-UI idiom: beige fills, 1px hairline
// borders, selection shown by swapping a border colour. Every one of
// those is a value this app does not otherwise contain, and
// constants/surface.ts already argues the case against the hairline —
// "a 1px border reads as an anti-aliasing artefact rather than as a
// drawn edge... A surface with no edge looks like a hole in the screen."
//
// So a field is what every other surface in this app is: white paper
// with a DRAWN edge. An <input> cannot hold the SVG that draws it, so
// the paper is a wrapper and the control sits inside it stripped of its
// own chrome. Same recipe as the chat composer, which is white card and
// a borderless input.
const FIELD_PAPER: React.CSSProperties = {
  position: 'relative',
  background: SURFACE.fill,
  borderRadius: R.chip,
  // Transparent, and reserved: the ink is the HandDrawnFrame child, but
  // the 2px still has to be here or the field loses 4px of height
  // against the pills it sits above. Same reason MODAL_PILL_LIGHT keeps
  // one it cannot show.
  border: '2px solid transparent',
  marginTop: 4,
};

// The control itself: no fill, no border, no focus ring. The paper
// around it is the field.
const FIELD_INPUT: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: SYSTEM_FONT,
  // 16px, not TYPE.body. Anything under 16 makes iOS Safari zoom the
  // viewport on focus and never zoom cleanly back — the same off-scale
  // value, for the same reason, as the chat composer's input.
  fontSize: 16,
  color: colors.black,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  padding: `${S.s}px ${S.m}px`,
  display: 'block',
};

const LABEL_STYLE: React.CSSProperties = {
  fontFamily: SYSTEM_FONT,
  fontSize: TYPE.small,
  fontWeight: 700,
  color: colors.grey,
  margin: `${S.m}px 0 0`,
};

// One field: the paper, its drawn edge, and whatever control is inside.
// `seed` keeps a given field's wobble stable across re-renders — a line
// that redraws itself on every keystroke is a line that twitches.
function Field({ seed, children }: { seed: string; children: React.ReactNode }) {
  return (
    <div style={FIELD_PAPER}>
      <HandDrawnFrame seed={seed} radius={R.chip} />
      {children}
    </div>
  );
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
  // `photoDropped` is worked out at submit time, not read off the photo
  // field on the done screen: the fields are cleared the moment a report
  // lands (see submit), so by then there is no photo left to look at.
  const [result, setResult] = useState<{ channelPostUrl: string | null; photoDropped: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Which opening of the sheet this is. Bumped on every close, and
  // captured by submit — an answer that lands after the sheet was closed
  // belongs to an opening that is over, and must not flip the NEXT one
  // straight to the "done" screen (UX-1.3).
  const openGenRef = useRef(0);
  // Where the sheet is showing. The pin step's crosshair and card are
  // portalled to <body>, so without this they would follow the owner
  // onto any other screen they reached (UX-2.2).
  const currentScreen = useGameStore((st) => st.currentScreen);

  // The three-state open/closing/unmount dance shared by the modal
  // family — the sheet has to outlive `open` long enough to animate out.
  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (rendered && !closing) {
      openGenRef.current += 1;
      setClosing(true);
      const timer = setTimeout(() => {
        setRendered(false);
        setClosing(false);
        // A finished (or abandoned) flow starts on the form next time. The
        // FIELDS are not touched here: an abandoned draft is kept, so a
        // brushed backdrop does not cost somebody their description. A
        // report that went through has already cleared them (submit).
        setStep('form');
        setError(null);
        setSending(false);
        setResult(null);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // THE PIN STEP OWNS THE SCREEN, and the screen has to be told. Hiding
  // this sheet is not enough on its own: the dog's ring is still open
  // underneath it and the dog is still standing on the exact point the
  // crosshair marks. Published to the store rather than solved locally
  // because the things that have to move — the HUD, the dashboard, the
  // companion — are not this component's to reach into, and the app
  // already has one path for "one job owns the screen".
  const setLostPinning = useGameStore((st) => st.setLostPinning);
  useEffect(() => {
    setLostPinning(rendered && step === 'pin');
  }, [rendered, step, setLostPinning]);
  // And never leave it set: an unmount mid-flow (tab change, a mode
  // flip) would otherwise strand the map with no HUD and no dog.
  useEffect(() => () => setLostPinning(false), [setLostPinning]);

  // Back and Escape step out the way the pills do (UX-2.5, UX-14.1): off
  // the pin step to the form, off the form to the map. Refused while a
  // report is on the wire, for the reason `close` gives below.
  useSheetBack(open, () => {
    if (sending) return;
    if (step === 'pin') setStep('form');
    else onClose();
  });

  // A draft outlives the sheet (see the close effect) but not the Mini
  // App: while one is typed, Telegram asks before it closes, so a back
  // press too many does not throw somebody's description away.
  const hasDraft =
    name.trim().length > 0 || desc.trim().length > 0 || phone.trim().length > 0 || !!photoDataUrl || !!pin;
  useEffect(() => {
    setTelegramClosingConfirmation(hasDraft);
  }, [hasDraft]);
  useEffect(() => () => setTelegramClosingConfirmation(false), []);

  if (!rendered) return null;
  if (typeof document === 'undefined') return null;

  const s = t.modes.lostSheet;
  const botUrl = env.telegramBotUrl;

  // Everything that describes the pet. Only ever called once a report has
  // gone through — then these fields are somebody's published report,
  // and carrying them into the next one is how a second, duplicate
  // public post gets made (UX-1.3).
  const clearFields = () => {
    setSpecies('dog');
    setName('');
    setDesc('');
    setPhone('');
    setPhotoDataUrl(null);
    setPin(null);
  };

  const onPickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPhotoDataUrl(await fileToJpegBase64(file));
      setError(null);
    } catch {
      // SAY SO. This used to drop the file on the floor: an owner picked
      // a photo, nothing appeared, and nothing explained why. A HEIC off
      // an iPhone is the ordinary way to get here, not an edge case.
      setPhotoDataUrl(null);
      setError(s.errPhoto);
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
    const gen = openGenRef.current;
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
      // Published either way, so the fields go either way — even when
      // the sheet was closed while this was on the wire.
      clearFields();
      if (gen !== openGenRef.current) return;
      setResult({ channelPostUrl: r.channelPostUrl, photoDropped: !r.photoStored && !!photoDataUrl });
      setStep('done');
    } catch (err) {
      if (gen !== openGenRef.current) return;
      const msg = err instanceof Error ? err.message : '';
      setError(msg.includes('429') ? s.errLimit : s.errGeneric);
    } finally {
      if (gen === openGenRef.current) setSending(false);
    }
  };

  // Closing is refused while a report is on the wire. The request cannot
  // be taken back once sent, so a close there did not cancel anything:
  // it only hid the outcome, and a reopen before it landed offered a
  // live form to post the same pet twice (UX-1.3).
  const close = sending ? undefined : onClose;

  // ---- PIN MODE: the map does the work, we draw two things over it ----
  if (step === 'pin') {
    // Off the map there is nothing under the crosshair to aim at. The
    // step is kept rather than dropped: coming back to the map finds
    // the aim where it was left.
    if (currentScreen !== 'map') return null;
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
            lineHeight: 0,
            // The map underneath is crayon and the icon is ink, so the
            // shadow is what keeps the point readable over a dark park
            // or a building — the same problem SURFACE.onPhoto exists
            // for.
            filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.28))',
          }}
        >
          {/* The app's own pin, not the platform's. An emoji is a
              foreign object twice over: it is nobody's drawing, and it
              renders as a different picture on every OS — the one mark
              that says "your dog was HERE" cannot be the one mark we do
              not control. */}
          <Icon name="pin" size={44} />
        </div>
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: `calc(env(safe-area-inset-bottom, 0px) + 92px)`,
            transform: 'translateX(-50%)',
            zIndex: Z.MODAL_GLOBAL,
            width: 'min(92vw, 420px)',
            background: SURFACE.fill,
            borderRadius: R.card,
            // Reserved for the drawn edge below — see MODAL_PILL_LIGHT.
            border: '2px solid transparent',
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
              color: colors.black,
              marginBottom: S.s,
              textAlign: 'center',
            }}
          >
            {s.pinHint}
          </div>
          <div style={{ display: 'flex', gap: S.s }}>
            {/* Dark primary on the left, as on the form this step
                returns to (D10). It used to sit on the right here and
                on the left one step later. */}
            <button
              onClick={(e) => {
                playPop(e.currentTarget);
                // The point under the crosshair, read now. The bounds
                // midpoint and then GPS only if the map cannot answer —
                // no map means nothing was aimed at anyway.
                const { viewportCenter, userPosition } = useGameStore.getState();
                const center = readScreenCenter() ?? viewportCenter ?? userPosition;
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
            <button
              onClick={(e) => playPopThen(e.currentTarget, () => setStep('form'))}
              style={MODAL_PILL_LIGHT}
            >
              <HandDrawnFrame radius={R.button} />
              {s.pinBack}
            </button>
          </div>
        </div>
      </>,
      document.body,
    );
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={close}
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
              color: colors.black,
            }}
          >
            {step === 'done' ? s.doneTitle : s.title}
          </div>
        </div>

        <div style={{ padding: `0 ${S.l}px ${S.m}px`, overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {step === 'done' && result ? (
            <div style={{ fontFamily: SYSTEM_FONT, fontSize: TYPE.body, lineHeight: 1.5, color: colors.black }}>
              {s.doneBody}
              {result.photoDropped ? (
                <div style={{ marginTop: S.s, fontSize: TYPE.small, color: colors.grey }}>{s.doneNoPhoto}</div>
              ) : null}
            </div>
          ) : (
            <>
              {/* SPECIES: two pills, and the chosen one is INK. The app
                  has exactly one two-colour system — dark pill against
                  light pill — and a choice is what it is for. Selection
                  used to be a border-colour swap, which is a signal this
                  app uses nowhere else. */}
              <div style={{ display: 'flex', gap: S.s }}>
                {(['dog', 'cat'] as const).map((sp) => (
                  <button
                    key={sp}
                    onClick={(e) => {
                      playPop(e.currentTarget);
                      setSpecies(sp);
                    }}
                    style={species === sp ? MODAL_PILL_DARK : MODAL_PILL_LIGHT}
                  >
                    {species === sp ? null : (
                      <HandDrawnFrame seed={`species-${sp}`} radius={R.button} />
                    )}
                    {sp === 'dog' ? s.speciesDog : s.speciesCat}
                  </button>
                ))}
              </div>

              <div style={LABEL_STYLE}>{s.nameLabel}</div>
              <Field seed="name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={s.namePlaceholder}
                  maxLength={60}
                  style={FIELD_INPUT}
                />
              </Field>

              <div style={LABEL_STYLE}>{s.descLabel}</div>
              <Field seed="desc">
                <textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder={s.descPlaceholder}
                  maxLength={1500}
                  rows={4}
                  style={{ ...FIELD_INPUT, resize: 'none', minHeight: 96 }}
                />
              </Field>

              <div style={LABEL_STYLE}>{s.phoneLabel}</div>
              <Field seed="phone">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={s.phonePlaceholder}
                  maxLength={30}
                  inputMode="tel"
                  style={FIELD_INPUT}
                />
              </Field>

              {/* The two facts that are not text. Pills, because they are
                  things you press — they were field-shaped, which made a
                  button look like somewhere to type. Both stay LIGHT:
                  the dark pill is the primary action and there is only
                  one of those on a sheet, at the bottom. */}
              <div style={{ display: 'flex', gap: S.s, marginTop: S.m }}>
                <button
                  onClick={(e) => {
                    // No defer: the file picker only opens from inside
                    // the tap itself.
                    playPop(e.currentTarget);
                    fileInputRef.current?.click();
                  }}
                  style={MODAL_PILL_LIGHT}
                >
                  <HandDrawnFrame seed="photo-btn" radius={R.button} />
                  {photoDataUrl ? s.photoChange : s.photoLabel}
                </button>
                <button
                  onClick={(e) => playPopThen(e.currentTarget, () => setStep('pin'))}
                  style={MODAL_PILL_LIGHT}
                >
                  <HandDrawnFrame seed="pin-btn" radius={R.button} />
                  {/* The drawn pin, at the secondary size: this is not
                      the sheet's primary action, and INLINE_ICON.cta is
                      sized to dominate a label rather than sit beside
                      one. */}
                  <Icon name="pin" size={INLINE_ICON.secondary} />
                  {pin ? s.pinPicked : s.pickPin}
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  void onPickPhoto(e.target.files?.[0]);
                  // So the same file can be picked again — after an error,
                  // or after «remove photo». Same as AvatarStudio (UX-5.12).
                  e.target.value = '';
                }}
              />
              {/* The photo, on paper. Same construction as the pet card:
                  white margin, then the drawn line, then the picture —
                  never the picture running to a bare rounded edge. */}
              {photoDataUrl ? (
                <div
                  style={{
                    position: 'relative',
                    marginTop: S.s,
                    background: SURFACE.fill,
                    borderRadius: R.chip,
                    border: '2px solid transparent',
                    height: 148,
                  }}
                >
                  <HandDrawnFrame seed="photo-preview" radius={R.chip} />
                  {/* A DIV WITH A BACKGROUND, not an <img> — the same
                      construction the pet card uses, and for a reason
                      worth writing down: an <img> is a replaced element,
                      so `inset` alone does not size it. It draws at its
                      intrinsic pixels instead. Measured: a 512×512 photo
                      inside this 338×152 mount rendered at 512×512,
                      burst out of the frame, and crushed the line of
                      text underneath it to one character per row. A
                      background image has no intrinsic size to fall back
                      on and `cover` does the crop. */}
                  <div
                    role="img"
                    style={{
                      position: 'absolute',
                      inset: PHOTO_INSET,
                      borderRadius: Math.max(0, R.chip - PHOTO_INSET),
                      backgroundImage: `url("${photoDataUrl}")`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center center',
                      backgroundRepeat: 'no-repeat',
                    }}
                  />
                </div>
              ) : null}
              {/* A way to take the photo back off (UX-5.12). "Different
                  photo" only swaps it — an owner who attached the wrong
                  picture and has no right one had no way to send none.
                  A quiet text link, not a third pill: it is the least of
                  the things on this sheet. */}
              {photoDataUrl ? (
                <button
                  onClick={() => setPhotoDataUrl(null)}
                  disabled={sending}
                  style={{
                    // Quiet to look at, full-size to hit.
                    minHeight: 44,
                    padding: 0,
                    background: 'none',
                    border: 'none',
                    fontFamily: SYSTEM_FONT,
                    fontSize: TYPE.small,
                    fontWeight: 700,
                    color: colors.grey,
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                >
                  {s.photoRemove}
                </button>
              ) : null}

              {error ? (
                <div
                  style={{
                    marginTop: S.m,
                    padding: S.s,
                    borderRadius: R.label,
                    background: colors.redBg,
                    fontFamily: SYSTEM_FONT,
                    fontSize: TYPE.small,
                    color: colors.red,
                    fontWeight: 600,
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
                    color: colors.grey,
                  }}
                >
                  {s.botLine}{' '}
                  <a
                    onClick={(e) => {
                      e.preventDefault();
                      openTelegramChat(botUrl);
                    }}
                    href={botUrl}
                    style={{ color: colors.black, fontWeight: 700, cursor: 'pointer' }}
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
                  onClick={(e) => {
                    playPop(e.currentTarget);
                    openTelegramChat(
                      `https://t.me/share/url?url=${encodeURIComponent(result.channelPostUrl!)}`,
                    );
                  }}
                  style={MODAL_PILL_DARK}
                >
                  {s.doneShare}
                </button>
              ) : null}
              <button
                onClick={(e) => playPopThen(e.currentTarget, onClose)}
                style={MODAL_PILL_LIGHT}
              >
                <HandDrawnFrame radius={R.button} />
                {s.doneClose}
              </button>
            </>
          ) : (
            <>
              {/* The shared disabled pill while it sends (UX-9.3), not the
                  dark one faded — that still read as pressable. */}
              <button
                onClick={(e) => {
                  playPop(e.currentTarget);
                  void submit();
                }}
                disabled={sending}
                style={sending ? MODAL_PILL_DISABLED : MODAL_PILL_DARK}
              >
                {sending ? s.submitting : s.submit}
              </button>
              <button
                // Disabled while sending, so this is only ever onClose.
                onClick={(e) => playPopThen(e.currentTarget, onClose)}
                disabled={sending}
                style={{ ...MODAL_PILL_LIGHT, opacity: sending ? 0.6 : 1 }}
              >
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
