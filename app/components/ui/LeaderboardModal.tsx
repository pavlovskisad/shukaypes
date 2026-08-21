// Fullscreen "see all" modal for the territory standing. Opened by the
// "see all" link under the top ten on the tasks tab; renders the whole
// board as the same portrait rows the card uses, silhouettes and all.
// Floating X in the top-right corner closes; no header bar (the user
// just came from the card titled "who holds the city" — no need to
// repeat the label). Same sheet mechanics as LostDogsModal: nullable
// data doubles as the open flag, opacity-only fade, portal to body.
//
// EACH ROW IS A CARD HERE, and only here. On the tasks tab the board
// is five rows inside a card that already has a title, and a card per
// row there would be a card inside a card. This screen has nothing but
// the board, so every neighbour gets their own piece of paper — drawn
// edge, shadow, portrait, name, ground — and, underneath, the two
// things you can actually do about them.
//
// WHAT THE TWO PILLS ARE. "on the map" is the jump this modal already
// did on a row tap; it is now a button that says so. "wave" is the
// poke the map has always had on another walker (map/OtherWalker.tsx →
// gameStore.pokePlayer), brought to the one screen that lists everyone
// by name. There is no third pill for a message because there is no
// player-to-player messaging in this app — the chat tab is you and
// your own dog — and a button that opens nothing is worse than a
// button that isn't there.
//
// Waving is offered ONLY on someone whose dog is out right now (`pos`
// comes from live presence) and never on a bot: routes/poke.ts drops a
// poke aimed at a bot id on the floor, and a wave that silently goes
// nowhere is a lie told in a friendly voice.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TerritoryRanking } from '../../services/api';
import { Z } from '../../constants/z';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { SURFACE } from '../../constants/surface';
import { MODAL_PILL_DARK, MODAL_PILL_DISABLED, MODAL_PILL_LIGHT } from '../../constants/buttons';
import { useGameStore } from '../../stores/gameStore';
import { playPopThen } from '../../utils/popOnTap';
import { useStrings } from '../../i18n/useStrings';
import { HandDrawnFrame } from './HandDrawn';
import { OWN_COLOR_CSS, ownerColorCss } from '../map/territoryColor';
import { BoardRow } from './BoardRow';

const SHEET_ANIM_MS = 240;
// How long a card says "waved 👋" before going back to offering it.
const WAVED_MS = 1800;

interface Props {
  // null = closed. Non-null array = open showing those rows.
  board: TerritoryRanking[] | null;
  // Your rank on the FULL board, so your row reads in your blue here
  // exactly as it does on the card.
  youRank: number | null;
  onClose: () => void;
  // Tap a row → the parent jumps the map to that owner's ground. Rows
  // without geometry aren't tappable.
  onPick?: (row: TerritoryRanking) => void;
}

export function LeaderboardModal({ board, youRank, onClose, onPick }: Props) {
  const t = useStrings();
  const [renderBoard, setRenderBoard] = useState<TerritoryRanking[] | null>(board);
  const [closing, setClosing] = useState(false);
  const pokePlayer = useGameStore((s) => s.pokePlayer);
  // Which card is showing its "waved 👋" confirmation. One at a time is
  // enough: the label is feedback for the tap you just made, and a
  // board of dogs all claiming to have been waved at is noise.
  const [waved, setWaved] = useState<string | null>(null);
  const wavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (wavedTimer.current) clearTimeout(wavedTimer.current);
  }, []);

  // Fire-and-forget, like the map's poke: pokePlayer swallows its own
  // errors, and the wave is a wave — there is nothing useful to say to
  // someone whose wave didn't arrive.
  const wave = useCallback(
    (userId: string) => {
      void pokePlayer(userId);
      setWaved(userId);
      if (wavedTimer.current) clearTimeout(wavedTimer.current);
      wavedTimer.current = setTimeout(() => setWaved(null), WAVED_MS);
    },
    [pokePlayer],
  );

  useEffect(() => {
    if (board) {
      setRenderBoard(board);
      setClosing(false);
      return;
    }
    if (renderBoard && !closing) {
      setClosing(true);
      const timer = setTimeout(() => {
        setRenderBoard(null);
        setClosing(false);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(timer);
    }
    // The close timer must not re-arm when renderBoard/closing settle —
    // same deliberate dependency shape as every sheet modal here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  if (!renderBoard) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#ffffff',
        zIndex: Z.MODAL_GLOBAL,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      <div
        style={
          {
            position: 'absolute',
            inset: 0,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: '20px',
            // The close button ends at inset + 50 (top 14 + 36 tall),
            // so 72 left a 22px gap and the board read as starting
            // late. 60 clears the button by 10 and gets the first
            // name up where the eye goes first.
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 60px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
          } as React.CSSProperties
        }
      >
        {renderBoard.map((row, i) => {
          const isYou = youRank === i + 1;
          const pickable = !!onPick && !!row.mainPiece && row.mainPiece.length >= 3;
          // Out walking, someone else, and a person. All three, or no
          // wave — see the note at the top of the file.
          const wavable = !isYou && !row.bot && !!row.pos;
          return (
            <div
              key={row.userId}
              style={{
                position: 'relative',
                background: '#ffffff',
                borderRadius: R.card,
                // Transparent, like every other drawn surface: the ink
                // is the HandDrawnFrame below, but the 2px has to be
                // reserved or the card loses 4px against its neighbours.
                border: '2px solid transparent',
                boxShadow: SURFACE.lift,
                padding: `${S.s}px ${S.m}px ${S.m}px`,
                marginBottom: S.m,
              }}
            >
              <HandDrawnFrame seed={row.userId} radius={R.card} />
              <BoardRow
                rank={String(i + 1)}
                name={isYou ? t.tasks.boardYou : row.name}
                areaLabel={t.profile.areaValue(row.areaM2)}
                piece={row.mainPiece}
                color={isYou ? OWN_COLOR_CSS : ownerColorCss(row.userId)}
                you={isYou}
              />
              <div style={{ display: 'flex', gap: S.s, marginTop: S.s }}>
                <button
                  disabled={!pickable}
                  onClick={
                    pickable
                      ? (e) => playPopThen(e.currentTarget, () => onPick!(row))
                      : undefined
                  }
                  style={pickable ? MODAL_PILL_LIGHT : MODAL_PILL_DISABLED}
                >
                  {pickable ? <HandDrawnFrame seed={`${row.userId}-show`} radius={R.button} /> : null}
                  {t.tasks.boardShow}
                </button>
                {wavable ? (
                  <button
                    onClick={(e) => playPopThen(e.currentTarget, () => wave(row.userId))}
                    style={MODAL_PILL_DARK}
                  >
                    {waved === row.userId ? t.tasks.boardWaved : t.tasks.boardWave}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={(e) => playPopThen(e.currentTarget, onClose)}
        aria-label="Close"
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
          right: 18,
          width: 36,
          height: 36,
          borderRadius: R.pill,
          // Drawn ring — see the HandDrawnFrame child. The 2px stays
          // so the button keeps the size it had.
          border: '2px solid transparent',
          background: '#ffffff',
          color: '#1a1a1a',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: SURFACE.chip,
          fontSize: TYPE.display,
          lineHeight: 1,
          zIndex: 1,
        }}
      >
        <HandDrawnFrame radius={R.pill} />
        ×
      </button>
    </div>,
    document.body,
  );
}
