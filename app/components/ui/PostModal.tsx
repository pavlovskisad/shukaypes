// The owner's post, read inside the app.
//
// Until now finding out what a pet actually looked like meant leaving:
// «показати оголошення? там є контакти власника» opened OLX in a new
// tab. That existed for one reason — the phone number lived in the ad
// and we did not store the ad. We store it now.
//
// TWO AUDIENCES, ONE SCREEN. Mid-search the walker is answering "is this
// the dog?" and the useful part is the description: collar, temperament,
// what it answers to. After they report a sighting they need the phone.
// The SERVER decides which of those they get — it looks for a sightings
// row by this user for this pet — so this component just renders what it
// is handed and explains any gaps.
//
// THE EMPTY STATE IS THE COMMON ONE, for now. Every pet ingested before
// 17 Aug has no stored body, and that stays true for weeks. So a missing
// ad must read as "it lives over there" with the old link intact, never
// as a broken panel.

import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Z } from '../../constants/z';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { MODAL_PILL_DARK, MODAL_PILL_LIGHT } from '../../constants/buttons';
import { SURFACE } from '../../constants/surface';
import { api } from '../../services/api';
import { useStrings } from '../../i18n/useStrings';
import { HandDrawnFrame } from './HandDrawn';

const SHEET_ANIM_MS = 280;

// An ad body is the longest continuous prose anywhere in this app, so it
// gets a reading line-height rather than the tighter one the cards use.
const BODY_TEXT: CSSProperties = {
  fontFamily: SYSTEM_FONT,
  fontSize: TYPE.body,
  lineHeight: 1.5,
};

interface PostModalProps {
  // The pet whose ad to show, or null when closed.
  dogId: string | null;
  dogName?: string;
  onClose: () => void;
}

interface PostState {
  body: string | null;
  contactsHidden: boolean;
  // The walker did everything right and the number is STILL stars —
  // because OLX masked it on its own page. Different sentence, different
  // remedy: one tap on the original, rather than "go report a sighting".
  contactsMasked: boolean;
  sourceUrl: string | null;
}

export function PostModal({ dogId, dogName, onClose }: PostModalProps) {
  const t = useStrings();
  const [renderId, setRenderId] = useState<string | null>(dogId);
  const [closing, setClosing] = useState(false);
  const [post, setPost] = useState<PostState | null>(null);
  const [failed, setFailed] = useState(false);

  // Same open/close dance as SpotModal and LostDogModal, so the three
  // read as one family rather than three different sheets.
  useEffect(() => {
    if (dogId) {
      setRenderId(dogId);
      setClosing(false);
      return;
    }
    if (renderId && !closing) {
      setClosing(true);
      const timer = setTimeout(() => {
        setRenderId(null);
        setClosing(false);
        // Dropped on close so reopening a different pet never flashes
        // the previous pet's ad while the new one loads.
        setPost(null);
        setFailed(false);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(timer);
    }
  }, [dogId]);

  useEffect(() => {
    if (!dogId) return;
    let cancelled = false;
    setPost(null);
    setFailed(false);
    api
      .getDogPost(dogId)
      .then((res) => {
        if (!cancelled) setPost(res);
      })
      .catch(() => {
        // A failure here is not the same as an ad we do not have: one
        // means "try again", the other means "it is on OLX". The UI says
        // different things for each.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dogId]);

  if (!renderId) return null;
  if (typeof document === 'undefined') return null;

  const loading = !post && !failed;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,20,15,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        // MODAL_GLOBAL, not MODAL_MAP, because this sheet is opened FROM
        // the tier-3 modals — the pet card and the end-of-search prompt.
        // Both are dismissed on the way in, but their close animation
        // still has ~280ms to run, and a reader that spends that time
        // underneath the card it came from reads as a broken tap.
        zIndex: Z.MODAL_GLOBAL,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderBottomLeftRadius: R.card,
          borderBottomRightRadius: R.card,
          width: '100%',
          maxWidth: 460,
          maxHeight: 'calc(100vh - 110px - env(safe-area-inset-bottom))' as unknown as number,
          display: 'flex',
          flexDirection: 'column',
          animation: `top-sheet-${closing ? 'out' : 'in'} ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`,
          boxShadow: SURFACE.lift,
          // A top sheet slides down from off-screen and runs to both
          // screen edges, so it has exactly one edge the eye can see:
          // the bottom, with its two rounded corners. Inking all four
          // would draw a line along the top that is never on screen and
          // two down the sides that sit flush against the bezel.
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Those three edges, drawn rather than bordered — see
            HandDrawn.tsx. The fourth is never on screen. */}
        <HandDrawnFrame radius={R.card} open="top" />
        <div
          style={{
            padding: `calc(env(safe-area-inset-top, 0px) + ${S.l}px) ${S.l}px ${S.s}px`,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontFamily: SYSTEM_FONT,
              fontSize: TYPE.title,
              fontWeight: 800,
              color: '#2B2B26',
            }}
          >
            {dogName ? t.modals.post.titleNamed(dogName) : t.modals.post.title}
          </div>
        </div>

        {/* THE AD. Scrolls inside the sheet rather than growing it —
            bodies run to a few thousand characters and a card that
            grows off-screen takes its own close button with it.
            whiteSpace: pre-wrap because the poster's line breaks carry
            meaning: they separate description from where and when. */}
        <div
          style={{
            padding: `0 ${S.l}px ${S.m}px`,
            overflowY: 'auto',
            flex: 1,
            minHeight: 0,
          }}
        >
          {loading ? (
            <div style={{ ...BODY_TEXT, color: '#8A867C' }}>{t.modals.post.loading}</div>
          ) : null}

          {failed ? (
            <div style={{ ...BODY_TEXT, color: '#A2452F' }}>{t.modals.post.failed}</div>
          ) : null}

          {post?.body ? (
            <div style={{ ...BODY_TEXT, color: '#2B2B26', whiteSpace: 'pre-wrap' }}>{post.body}</div>
          ) : null}

          {post && !post.body ? (
            <div style={{ ...BODY_TEXT, color: '#5A5750' }}>
              {t.modals.post.notStored}
              {/* No body AND no link means the walker has not reported a
                  sighting yet — the original is behind the same gate the
                  contacts are. Saying so beats an empty sheet with a
                  close button. */}
              {post.sourceUrl ? null : ` ${t.modals.post.originalAfterSighting}`}
            </div>
          ) : null}

          {/* Says WHY the ad has holes in it. Without this the masking
              reads as the owner having written it that way, or as a
              bug. */}
          {/* NOT the same message as the one below, and the difference
              matters to somebody standing in the street holding a phone.
              «contactsHidden» means we are withholding it and walking on
              will fix that. This means the digits were never ours: OLX
              prints «05*******62» and reveals the rest on a tap, so the
              only way through is the original. Saying "report a sighting"
              to a walker who already has would be a lie they can check. */}
          {post?.contactsMasked ? (
            <div
              style={{
                marginTop: S.m,
                padding: S.s,
                borderRadius: R.chip,
                background: '#F3F0E7',
                fontFamily: SYSTEM_FONT,
                fontSize: TYPE.small,
                lineHeight: 1.45,
                color: '#5A5750',
              }}
            >
              {t.modals.post.contactsMaskedBySource}
            </div>
          ) : null}

          {post?.contactsHidden ? (
            <div
              style={{
                marginTop: S.m,
                padding: S.s,
                borderRadius: R.chip,
                background: '#F3F0E7',
                fontFamily: SYSTEM_FONT,
                fontSize: TYPE.small,
                lineHeight: 1.45,
                color: '#5A5750',
              }}
            >
              {t.modals.post.contactsAfterSighting}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            gap: S.s,
            padding: `${S.s}px ${S.l}px calc(${S.l}px + env(safe-area-inset-bottom, 0px))`,
            flexShrink: 0,
          }}
        >
          {/* The original stays reachable. For a pet with no stored ad
              it is the only way through, and for one whose contacts are
              masked it is where the owner's own posting lives. */}
          {/* Straight from constants/buttons — the first version used
              MODAL_PILL_DARK for both and faked the secondary with
              opacity: 0.75, which is off the rails every other modal
              runs on. Dark for the action, light for dismiss, same
              recipe LostDogModal and SpotModal use. */}
          {post?.sourceUrl ? (
            <button
              onClick={() => window.open(post.sourceUrl!, '_blank', 'noopener')}
              style={MODAL_PILL_DARK}
            >
              {t.modals.post.openOriginal}
            </button>
          ) : null}
          <button onClick={onClose} style={MODAL_PILL_LIGHT}>
            <HandDrawnFrame radius={R.button} />
            {t.modals.common.close}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
