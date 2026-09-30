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
import { COLUMN, OVERLAY, PAPER, Primary } from '../ui/AccountDoor';
import { CloseButton } from '../ui/CloseButton';
import { CLOSE_INSET, CLOSE_SIZE } from '../../constants/buttons';
import { ownerColorCss } from './territoryColor';
import { TerritoryMini } from '../ui/TerritoryMini';
import { INK } from '../../constants/surface';
import { S } from '../../constants/spacing';
import { R } from '../../constants/radius';
import { TYPE } from '../../constants/type';
import { SYSTEM_FONT } from '../../constants/fonts';
import { colors } from '../../constants/colors';
import { useSheetBack } from '../../hooks/useSheetBack';

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
  // idle → sending → waved (or failed) → idle. The label only says
  // "waved!" once the server has the wave: it used to say so on the tap,
  // offline too, about a notification that never went out.
  const [pokeState, setPokeState] = useState<'idle' | 'sending' | 'waved' | 'failed'>('idle');

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

  // Back and Escape close it, like the tap outside (UX-2.5, UX-14.1).
  useSheetBack(true, onClose);

  const avatar = card?.avatarUrl ?? player.avatarUrl ?? null;
  const name = card?.name ?? player.name;
  // The person behind the dog's name (D-73): the nickname on the small
  // line, so a friend can still find who it is.
  const owner = card ? card.owner : (player.owner ?? null);
  const isBot = card?.bot ?? !!player.bot;

  const poke = () => {
    // Each poke is a notification on a real person's phone. The button
    // stays disabled from the tap through the cooldown, or a thumb
    // drumming on it sends one per tap.
    if (pokeState !== 'idle') return;
    haptic('medium');
    setPokeState('sending');
    void pokePlayer(player.id).then((ok) => {
      setPokeState(ok ? 'waved' : 'failed');
      setTimeout(() => setPokeState('idle'), 1500);
    });
  };
  const pokeLabel =
    pokeState === 'waved' ? t.poked : pokeState === 'failed' ? t.pokeFailed : t.poke;

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
    // A circle, like every portrait in the app (D14). And a blank fill
    // underneath, so a walker who never drew one leaves a slot rather
    // than a 128px hole in the paper (UX-10.13).
    borderRadius: R.pill,
    backgroundColor: colors.portraitBlank,
    backgroundImage: avatar ? `url("${avatar}")` : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center center',
    backgroundRepeat: 'no-repeat',
  };

  return createPortal(
    <div style={OVERLAY} role="dialog" aria-modal="true">
      {/* Tap outside the paper: close. */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }} onClick={onClose} />
      <div style={{ ...COLUMN, bottom: `calc(env(safe-area-inset-bottom, 0px) + ${S.m}px)` }}>
        <div style={{ ...PAPER, padding: S.l }}>
          <HandDrawnFrame seed={`card-${player.id}`} radius={R.card} />
          {/* The app's one close (D9), in the corner like every sheet's.
              It was a text link under the wave button — the only card
              whose way out was a word. */}
          <CloseButton
            label={t.close}
            onPress={onClose}
            style={{ position: 'absolute', top: CLOSE_INSET, right: CLOSE_INSET, zIndex: 1 }}
          />
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.m }}>
            <div style={portrait} role="img" aria-label={name} />
            {/* Right padding keeps the name's ellipsis clear of the
                close circle in the corner. */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                paddingRight: CLOSE_SIZE - S.xs,
              }}
            >
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
                {isBot ? ` · ${t.bot}` : owner ? ` · ${t.owner(owner)}` : ''}
              </div>
              {/* Only once the card has answered. On a failed load the row
                  used to say "no territory yet" — a claim about a dog
                  whose ground was never asked about. The level line
                  above already says it is unknown. */}
              {card ? (
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
                      {card.areaM2 > 0 ? t.territory : t.noTerritory}
                    </div>
                    {card.areaM2 > 0 ? (
                      <div style={{ font: `500 ${TYPE.small}px ${SYSTEM_FONT}`, color: colors.grey, marginTop: 2 }}>
                        {tp.areaValue(card.areaM2)}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <Primary label={pokeLabel} disabled={pokeState !== 'idle'} onClick={poke} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
