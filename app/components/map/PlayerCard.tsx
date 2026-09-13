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

const PORTRAIT = 96;
const MINI = 56;

// The largest piece of ground as a thumbnail: the ring fitted into a
// square, longitude scaled by cos(lat) so the shape is the shape on the
// map and not a stretched one.
function MiniTerritory({ id, piece }: { id: string; piece: { lat: number; lng: number }[] }) {
  const lat0 = piece.reduce((a, p) => a + p.lat, 0) / piece.length;
  const k = Math.cos((lat0 * Math.PI) / 180) || 1;
  const xs = piece.map((p) => p.lng * k);
  const ys = piece.map((p) => -p.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = 4;
  const sc = (MINI - pad * 2) / span;
  const ox = pad + ((MINI - pad * 2) - (maxX - minX) * sc) / 2;
  const oy = pad + ((MINI - pad * 2) - (maxY - minY) * sc) / 2;
  const d = piece
    .map((_, i) => `${i ? 'L' : 'M'}${(ox + (xs[i]! - minX) * sc).toFixed(1)} ${(oy + (ys[i]! - minY) * sc).toFixed(1)}`)
    .join(' ') + ' Z';
  return (
    <svg width={MINI} height={MINI} viewBox={`0 0 ${MINI} ${MINI}`} aria-hidden style={{ flex: 'none' }}>
      <path d={d} fill={ownerColorCss(id)} fillOpacity={0.45} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function PlayerCard({ player, onClose }: Props) {
  const t = useStrings().playerCard;
  const tp = useStrings().profile;
  const pokePlayer = useGameStore((s) => s.pokePlayer);
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
          <div style={{ display: 'flex', alignItems: 'center', gap: S.m }}>
            <div style={portrait} role="img" aria-label={name} />
            <div style={{ flex: 1, minWidth: 0 }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: S.s, marginTop: S.s }}>
                {card?.piece ? <MiniTerritory id={player.id} piece={card.piece} /> : null}
                <div style={{ font: `500 ${TYPE.small}px ${SYSTEM_FONT}`, color: INK }}>
                  {card
                    ? card.areaM2 > 0
                      ? `${t.territory} ${tp.areaValue(card.areaM2)}`
                      : t.noTerritory
                    : failed
                      ? t.noTerritory
                      : ''}
                </div>
              </div>
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
