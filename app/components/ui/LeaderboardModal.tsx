// Fullscreen "see all" modal for the territory standing — and, since
// D-75, for the happiness index too (`kind`): the same portrait rows,
// the silhouette for one and the big number for the other. Opened by
// the "see all" link under the card's rows on the tasks tab.
// Floating X in the top-right corner closes; no header bar (the user
// just came from the card titled "who holds the city" — no need to
// repeat the label). Same sheet mechanics as LostDogsModal: nullable
// data doubles as the open flag, opacity-only fade, portal to body.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HappinessRanking, TerritoryRanking } from '../../services/api';
import { Z } from '../../constants/z';
import { R } from '../../constants/radius';
import { TYPE } from '../../constants/type';
import { SURFACE } from '../../constants/surface';
import { playPopThen } from '../../utils/popOnTap';
import { useStrings } from '../../i18n/useStrings';
import { HandDrawnFrame } from './HandDrawn';
import { OWN_COLOR_CSS, ownerColorCss } from '../map/territoryColor';
import { BoardRow } from './BoardRow';

const SHEET_ANIM_MS = 240;

// The happiness index at the row's end, the same width as the
// territory silhouette so the two boards' rows line up.
const INDEX: React.CSSProperties = {
  display: 'inline-block',
  width: 92,
  textAlign: 'center',
  fontSize: TYPE.display,
  fontWeight: 800,
  flex: 'none',
};

type Row = TerritoryRanking | HappinessRanking;

interface Props {
  // null = closed. Non-null array = open showing those rows.
  board: Row[] | null;
  // Which board these rows are: the territory standing (silhouettes,
  // tappable rows) or the happiness index (the number, no tap).
  kind?: 'territory' | 'happiness';
  // Your rank on the FULL board, so your row reads in your blue here
  // exactly as it does on the card.
  youRank: number | null;
  onClose: () => void;
  // Tap a row → the parent jumps the map to that owner's ground. Rows
  // without geometry aren't tappable.
  onPick?: (row: TerritoryRanking) => void;
}

export function LeaderboardModal({ board, kind = 'territory', youRank, onClose, onPick }: Props) {
  const t = useStrings();
  const [renderBoard, setRenderBoard] = useState<Row[] | null>(board);
  const [closing, setClosing] = useState(false);

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
          if (kind === 'happiness') {
            const h = row as HappinessRanking;
            return (
              <BoardRow
                key={h.userId}
                rank={String(i + 1)}
                name={isYou ? t.tasks.boardYou : h.name}
                areaLabel={t.profile.timeTogether(h.activeS)}
                piece={undefined}
                color={isYou ? OWN_COLOR_CSS : ownerColorCss(h.userId)}
                you={isYou}
                avatarUrl={h.avatarUrl}
                owner={isYou ? null : h.owner}
                trailing={
                  <span style={{ ...INDEX, color: isYou ? OWN_COLOR_CSS : undefined }}>{String(h.index)}</span>
                }
              />
            );
          }
          const r = row as TerritoryRanking;
          const pickable = onPick && r.mainPiece && r.mainPiece.length >= 3;
          return (
            <div
              key={r.userId}
              onClick={
                pickable
                  ? (e) => playPopThen(e.currentTarget, () => onPick(r))
                  : undefined
              }
              style={{ cursor: pickable ? 'pointer' : 'default' }}
            >
              <BoardRow
                rank={String(i + 1)}
                name={isYou ? t.tasks.boardYou : r.name}
                areaLabel={t.profile.areaValue(r.areaM2)}
                piece={r.mainPiece}
                color={isYou ? OWN_COLOR_CSS : ownerColorCss(r.userId)}
                you={isYou}
                avatarUrl={r.avatarUrl}
                owner={isYou ? null : r.owner}
              />
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
