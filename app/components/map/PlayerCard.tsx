// THE DOG'S CARD. D-73.
//
// Tap a chip on the map and this opens: the portrait big and with no
// edge of its own (the paper is the edge), the name, the level, the
// ground the dog holds as a thumbnail with its size, and the one thing
// to do about it — wave. No message button yet: the poke is the whole
// social layer today, and a button that opens nothing is a promise.
//
// The name and portrait come with the presence entry, so the card is
// full the instant it opens; the level and the ground arrive from
// GET /players/:id a moment later. Paper and column from AccountDoor,
// portaled like the edit sheet.

import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { NearbyPlayer, PlayerCard as Card } from '@shukajpes/shared';
import { api } from '../../services/api';
import { useStrings } from '../../i18n/useStrings';
import { useGameStore } from '../../stores/gameStore';
import { haptic } from '../../utils/haptics';
import { HandDrawnFrame } from '../ui/HandDrawn';
import { COLUMN, LINK, OVERLAY, PAPER, Primary } from '../ui/AccountDoor';
import { ownerColorCss } from './territoryColor';
import { TerritoryMini } from '../ui/TerritoryMini';
import { INK } from '../../constants/surface';
import { S } from '../../constants/spacing';
import { R } from '../../constants/radius';
import { TYPE } from '../../constants/type';
import { SYSTEM_FONT } from '../../constants/fonts';
import { colors } from '../../constants/colors';

interface Props {
  player: NearbyPlayer;
  onClose: () => void;
}

// The layout is the mock's: the portrait big on the left, and on the
// right, one under another, the name, the level and the ground. The
// portrait is the largest thing on the paper on purpose — the card is
// about a dog's face.
const PORTRAIT = 128;
// The territory thumbnail is the leaderboard's own (ui/TerritoryMini):
// the same simplification, the same dashed edge over a wash, the same
// recipe — so the piece a walker recognises in the standings is the
// piece on their card, not a cousin of it. Drawn a little under the
// board's 92 to share the right column with its label.
const MINI = 80;

export function PlayerCard({ player, onClose }: Props) {
  const t = useStrings().playerCard;
  const tp = useStrings().profile;
  const pokePlayer = useGameStore((s) => s.pokePlayer);
  const setFocusedTerritory = useGameStore((s) => s.setFocusedTerritory);
  const setAppMode = useGameStore((s) => s.setAppMode);
  const [card, setCard] = useState<Card | null>(null);
  const [failed, setFailed] = useState(false);
  const [poked, setPoked] = useState(false);

  useEffect(() => {
    let alive = true;
    setCard(null);
    setFailed(false);
    api
      .playerCard(player.id)
      .then((c) => {
        if (alive) setCard(c);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [player.id]);

  const avatar = card?.avatarUrl ?? player.avatarUrl ?? null;
  const name = card?.name ?? player.name;
  const isBot = card?.bot ?? !!player.bot;

  const poke = () => {
    haptic('medium');
    setPoked(true);
    setTimeout(() => setPoked(false), 1500);
    void pokePlayer(player.id);
  };

  // Tap the ground → the map lands on it, the same jump a row on the
  // standing makes (tasks.tsx onPickOwner): into the territory view
  // first, since ground is only drawn there, then the flight. The card
  // is already on the map screen, so there is no route to push; it
  // closes itself so the flight is visible.
  const piece = card?.piece ?? null;
  const showGround = () => {
    if (!piece || piece.length < 3) return;
    haptic('light');
    if (useGameStore.getState().appMode !== 'play') setAppMode('play');
    setFocusedTerritory({ ownerId: player.id, ring: piece, pos: player.position });
    onClose();
  };

  const portrait: CSSProperties = {
    width: PORTRAIT,
    height: PORTRAIT,
    flex: 'none',
    borderRadius: R.chip,
    backgroundImage: avatar ? `url("${avatar}")` : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center center',
    backgroundRepeat: 'no-repeat',
  };

  return createPortal(
    <div style={OVERLAY}>
      {/* Tap outside the paper: close. */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }} onClick={onClose} />
      <div style={{ ...COLUMN, bottom: `calc(env(safe-area-inset-bottom, 0px) + ${S.m}px)` }}>
        <div style={{ ...PAPER, padding: S.l }}>
          <HandDrawnFrame seed={`card-${player.id}`} radius={R.card} />
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.m }}>
            <div style={portrait} role="img" aria-label={name} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  font: `700 ${TYPE.hero}px ${SYSTEM_FONT}`,
                  color: INK,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {name}
              </div>
              <div style={{ font: `500 ${TYPE.small}px ${SYSTEM_FONT}`, color: colors.grey, marginTop: 2 }}>
                {card ? (card.level === null ? t.levelUnknown : tp.level(card.level)) : failed ? t.levelUnknown : '…'}
                {isBot ? ` · ${t.bot}` : ''}
              </div>
              {card || failed ? (
                <div
                  role={piece ? 'button' : undefined}
                  onClick={piece ? showGround : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: S.s,
                    marginTop: S.s,
                    cursor: piece ? 'pointer' : 'default',
                  }}
                >
                  {piece ? <TerritoryMini points={piece} color={ownerColorCss(player.id)} size={MINI} /> : null}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: `600 ${TYPE.body}px ${SYSTEM_FONT}`, color: INK }}>
                      {card && card.areaM2 > 0 ? t.territory : t.noTerritory}
                    </div>
                    {card && card.areaM2 > 0 ? (
                      <div style={{ font: `500 ${TYPE.small}px ${SYSTEM_FONT}`, color: colors.grey, marginTop: 2 }}>
                        {tp.areaValue(card.areaM2)}
                      </div>
                    ) : null}
                    {piece ? (
                      <div style={{ ...LINK, display: 'inline-block', marginTop: S.xs }}>{t.showOnMap}</div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <Primary label={poked ? t.poked : t.poke} onClick={poke} />
          <button type="button" style={{ ...LINK, alignSelf: 'center', marginTop: S.m }} onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
