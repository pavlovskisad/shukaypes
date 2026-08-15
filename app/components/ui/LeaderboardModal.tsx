// Fullscreen "see all" modal for the territory standing. Opened by the
// "see all" link under the top ten on the tasks tab; renders the whole
// board as the same portrait rows the card uses, silhouettes and all.
// Floating X in the top-right corner closes; no header bar (the user
// just came from the card titled "who holds the city" — no need to
// repeat the label). Same sheet mechanics as LostDogsModal: nullable
// data doubles as the open flag, opacity-only fade, portal to body.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TerritoryRanking } from '../../services/api';
import { Z } from '../../constants/z';
import { R } from '../../constants/radius';
import { TYPE } from '../../constants/type';
import { playPopThen } from '../../utils/popOnTap';
import { useStrings } from '../../i18n/useStrings';
import { OWN_COLOR_CSS, ownerColorCss } from '../map/territoryColor';
import { BoardRow } from './BoardRow';

const SHEET_ANIM_MS = 240;

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
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 72px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
          } as React.CSSProperties
        }
      >
        {renderBoard.map((row, i) => {
          const isYou = youRank === i + 1;
          const pickable = onPick && row.mainPiece && row.mainPiece.length >= 3;
          return (
            <div
              key={row.userId}
              onClick={
                pickable
                  ? (e) => playPopThen(e.currentTarget, () => onPick(row))
                  : undefined
              }
              style={{ cursor: pickable ? 'pointer' : 'default' }}
            >
              <BoardRow
                rank={String(i + 1)}
                name={isYou ? t.tasks.boardYou : row.name}
                areaLabel={t.profile.areaValue(row.areaM2)}
                piece={row.mainPiece}
                color={isYou ? OWN_COLOR_CSS : ownerColorCss(row.userId)}
                you={isYou}
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
          border: '1px solid rgba(0,0,0,0.06)',
          background: '#ffffff',
          color: '#1a1a1a',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
          fontSize: TYPE.display,
          lineHeight: 1,
          zIndex: 1,
        }}
      >
        ×
      </button>
    </div>,
    document.body,
  );
}
