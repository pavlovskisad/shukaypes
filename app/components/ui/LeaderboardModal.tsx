// Fullscreen "see all" modal for the territory standing — and, since
// D-75, for the happiness index too (`kind`): the same portrait rows,
// the silhouette for one and the big number for the other. Opened by
// the "see all" link under the card's rows on the tasks tab.
// Floating X in the top-right corner closes. No drawn header bar, but a
// title sits level with the close: the two boards share one layout, so
// without it a full screen of portraits and numbers never said whether
// it was the territory standing or the happiness index (UX-11.9). Same
// sheet mechanics as LostDogsModal: nullable data doubles as the open
// flag, opacity-only fade, portal to body.

import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HappinessRanking, TerritoryRanking } from '../../services/api';
import { Z } from '../../constants/z';
import { TYPE } from '../../constants/type';
import { SYSTEM_FONT } from '../../constants/fonts';
import { INK } from '../../constants/surface';
import { S } from '../../constants/spacing';
import { playPopThen } from '../../utils/popOnTap';
import { useStrings } from '../../i18n/useStrings';
import { CloseButton } from './CloseButton';
import { CLOSE_SIZE, CLOSE_INSET } from '../../constants/buttons';
import { OWN_COLOR_CSS, ownerColorCss } from '../map/territoryColor';
import { BoardRow } from './BoardRow';
import { useSheetBack } from '../../hooks/useSheetBack';
import { MOTION } from '../../utils/motion';

const SHEET_ANIM_MS = MOTION.sheetMs;

// The happiness index at the row's end, the same width as the
// territory silhouette so the two boards' rows line up.
const INDEX: React.CSSProperties = {
  display: 'inline-block',
  width: 92,
  textAlign: 'center',
  fontSize: TYPE.display,
  fontWeight: 700,
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
  // `isYou` so the caller can send your own row to your ground rather
  // than pinning you as a guest on your own map (UX-1.9).
  onPick?: (row: TerritoryRanking, isYou: boolean) => void;
}

export function LeaderboardModal({ board, kind = 'territory', youRank, onClose, onPick }: Props) {
  const t = useStrings();
  const titleId = useId();
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

  // Back and Escape close it, like its close pill (UX-2.5, UX-14.1).
  useSheetBack(!!board, onClose);

  if (!renderBoard) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
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
            // The close button ends at inset + 56 (top 12 + 44 tall),
            // so 72 left a gap wide enough that the board read as
            // starting late. 66 clears the button by 10 and gets the
            // first name up where the eye goes first.
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 66px)',
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
                  ? (e) => playPopThen(e.currentTarget, () => onPick(r, isYou))
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

      {/* The board's name, on the close's line: same top, same height,
          centred on it, and stopping short of it so a long name
          ellipsizes instead of running under the disc. It sits on a
          white band from the top edge down to the close's bottom, the
          sheet's own paper: bare text over a scroller, the rows
          scrolled up through the title and the two read as one line. */}
      <div
        id={titleId}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          boxSizing: 'border-box',
          height: `calc(env(safe-area-inset-top, 0px) + ${CLOSE_INSET + CLOSE_SIZE}px)`,
          paddingTop: `calc(env(safe-area-inset-top, 0px) + ${CLOSE_INSET}px)`,
          paddingLeft: 20,
          paddingRight: CLOSE_INSET + CLOSE_SIZE + S.s,
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          fontFamily: SYSTEM_FONT,
          fontSize: TYPE.title,
          fontWeight: 700,
          color: INK,
          zIndex: 1,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {kind === 'happiness' ? t.tasks.happinessBoard : t.tasks.territoryBoard}
        </span>
      </div>

      <CloseButton
        onPress={onClose}
        style={{
          position: 'absolute',
          top: `calc(env(safe-area-inset-top, 0px) + ${CLOSE_INSET}px)`,
          right: CLOSE_INSET,
          zIndex: 1,
        }}
      />
    </div>,
    document.body,
  );
}
