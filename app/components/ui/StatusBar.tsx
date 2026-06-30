import { useEffect, useRef, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useGameStore } from '../../stores/gameStore';
import { colors } from '../../constants/colors';
import { CHIP } from '../../constants/sizing';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { popPressableEvent } from '../../utils/popOnTap';
import { Icon, type IconName } from './Icon';
import { useStrings } from '../../i18n/useStrings';

// Four white-frosted-glass pills laid out identically: icon + value with
// a consistent gap so happiness / hunger / tokens / spots-toggle read
// as one family. Happiness + hunger are 0-100 meters with a blue
// progress fill; the paw pill is a lifetime count. The rightmost is a
// tap-to-toggle visibility switch for the spots layer.

const PILL_HEIGHT = CHIP.height;
// Minimum so a 1-char value doesn't collapse the pill awkwardly; beyond
// that, each pill sizes to its content and grows when the number widens.
const PILL_MIN_WIDTH = 50;

const PROGRESS_BLUE = 'rgb(0,60,255)';
const GLASS_BG = '#ffffff';
const GLASS_SHADOW_COLOR = '#000';
// HUD icons are pixel-art SVGs (see components/ui/Icon.tsx). 18px
// renders crisp at the 38px pill height; smaller (the previous emoji
// fontSize 14) read as cramped against the value text.
const ICON_SIZE = CHIP.icon;

// Attention ring for hint cues — an expanding outline pulse that blooms
// OUT FROM a HUD pill while a hint is calling the user's eye to it.
//
// Rendered as a sibling BEHIND the pill (via PulseWrap) rather than a
// child of it: the pills clip their content (overflow:hidden, needed for
// the blue meter fill), and a ring drawn inside that clip both got cut
// off at the pill edge AND vanished against the blue fill of the
// happiness / hunger pills. Blooming outside puts the ring over the
// light map instead, where it actually reads. Exported so the corner
// logo (super-sniff cue) can use the exact same ring.
export function PillPulseRing() {
  return (
    <>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          // Slightly larger than the pill so the ring is already peeking
          // past the edges at the start of each pulse, not hidden behind.
          width: 'calc(100% + 10px)',
          height: 'calc(100% + 10px)',
          borderRadius: 999,
          border: '3px solid rgba(0,0,0,0.55)',
          transform: 'translate(-50%, -50%) scale(0.85)',
          animation: 'hint-pill-ring 1.4s ease-out infinite',
          pointerEvents: 'none',
        }}
      />
      <style>{`
        @keyframes hint-pill-ring {
          0%   { transform: translate(-50%, -50%) scale(0.85); opacity: 0.75; }
          100% { transform: translate(-50%, -50%) scale(1.7);  opacity: 0; }
        }
      `}</style>
    </>
  );
}

// Wraps a pill so the attention ring can bloom outside it. The wrapper
// stays unclipped (no overflow:hidden) and the ring paints behind the
// pill, so the visible part of the ring is the halo spilling past the
// pill edges. No-op passthrough when not active to avoid an extra layout
// node in the common case.
function PulseWrap({ active, children }: { active: boolean; children: ReactNode }) {
  if (!active) return <>{children}</>;
  return (
    <View style={{ position: 'relative' }}>
      <PillPulseRing />
      {children}
    </View>
  );
}

// Accent glow per meter, matching the map collectibles: sun = warm,
// bone = amber, paws = lime. Used for the pickup pop flash below.
function glowForIcon(icon: IconName): string {
  switch (icon) {
    case 'sun':
      return 'rgba(245,200,70,0.95)';
    case 'bone':
      return 'rgba(245,180,70,0.95)';
    case 'paws':
      return 'rgba(150,220,70,0.95)';
    default:
      return 'rgba(255,255,255,0.9)';
  }
}

// Pop + glow flash a pill whenever its value goes UP — the HUD half of
// the collect dopamine loop (paws/hunger/happiness all rise on a pickup).
// Returns a ref to put on a web wrapper around the pill. Decreases
// (passive hunger/happiness decay) are ignored, so only gains celebrate.
// The very first value the pill mounts with is the baseline (no pop), so
// a fresh load doesn't fire a spurious flash.
function usePopOnIncrease(value: number, glow: string) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    const wentUp = value > prev.current;
    prev.current = value;
    if (!wentUp || !ref.current || typeof ref.current.animate !== 'function') return;
    ref.current.animate(
      [
        { transform: 'scale(1)', filter: 'brightness(1) drop-shadow(0 0 0 rgba(0,0,0,0))' },
        {
          transform: 'scale(1.18)',
          filter: `brightness(1.2) drop-shadow(0 0 9px ${glow})`,
          offset: 0.4,
        },
        { transform: 'scale(1)', filter: 'brightness(1) drop-shadow(0 0 0 rgba(0,0,0,0))' },
      ],
      { duration: 460, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    );
  }, [value, glow]);
  return ref;
}

export function MeterPill({
  icon,
  value,
  label,
  solid,
  showValue = true,
  pulse,
}: {
  icon: IconName;
  value: number;
  label: string;
  // Drops the frosted-glass treatment for a plain-white pill —
  // used on the profile tab where the dark night sky behind makes
  // the translucent default read as greyish.
  solid?: boolean;
  // Hide the "%" text and rely on the blue fill alone as the
  // indicator. Profile uses this so the hunger / happiness pills
  // read as quiet chips; map HUD keeps the default so the user
  // gets the exact number while walking.
  showValue?: boolean;
  // Show the hint attention ring (driven by the HUD-meters hint).
  pulse?: boolean;
}) {
  const fillPct = Math.max(0, Math.min(100, Math.round(value)));
  const popRef = usePopOnIncrease(value, glowForIcon(icon));
  return (
    <div ref={popRef} style={{ display: 'inline-flex' }}>
      <PulseWrap active={!!pulse}>
        <View style={[styles.pill, styles.meterPill, solid && styles.pillSolid]}>
          <View
            style={[
              styles.fill,
              {
                width: `${fillPct}%` as unknown as number,
                backgroundColor: PROGRESS_BLUE,
              },
            ]}
          />
          <Icon name={icon} size={ICON_SIZE} />
          {showValue ? (
            <Text
              style={styles.value}
              accessibilityLabel={`${label} ${fillPct} percent`}
            >
              {fillPct}%
            </Text>
          ) : null}
        </View>
      </PulseWrap>
    </div>
  );
}

export function CounterPill({
  icon,
  value,
  label,
  suffix,
  solid,
  pulse,
}: {
  icon: IconName;
  value: number;
  label: string;
  suffix?: string;
  solid?: boolean;
  // Show the hint attention ring (driven by the HUD-meters hint).
  pulse?: boolean;
}) {
  const popRef = usePopOnIncrease(value, glowForIcon(icon));
  return (
    <div ref={popRef} style={{ display: 'inline-flex' }}>
      <PulseWrap active={!!pulse}>
        <View style={[styles.pill, styles.counterPill, solid && styles.pillSolid]}>
          <Icon name={icon} size={ICON_SIZE} />
          <Text style={styles.value} accessibilityLabel={`${label} ${Math.round(value)}`}>
            {Math.round(value)}
            {suffix ?? ''}
          </Text>
        </View>
      </PulseWrap>
    </div>
  );
}

// Tap-to-toggle visibility of the spots overlay. Off state dims the
// pin icon + softens the pill bg; on state matches the rest of the
// HUD family. Independent of whether spots are loaded into the
// store — the user can hide the cached layer without re-fetching.
function SpotsTogglePill() {
  const visible = useGameStore((s) => s.spotsVisible);
  const setVisible = useGameStore((s) => s.setSpotsVisible);
  // Pulse while the spots-toggle hint is calling attention to this pill
  // (published by the Companion via activeHint).
  const pulse = useGameStore((s) => s.activeHint) === 'map:spots-toggle';
  const t = useStrings();
  return (
    <PulseWrap active={pulse}>
      <Pressable
        onPress={() => setVisible(!visible)}
        onPressIn={popPressableEvent}
        accessibilityRole="switch"
        accessibilityState={{ checked: visible }}
        accessibilityLabel={visible ? t.hud.spotsVisible : t.hud.spotsHidden}
        style={({ pressed }) => [
          styles.pill,
          styles.togglePill,
          !visible && styles.togglePillOff,
          pressed && { opacity: 0.7 },
        ]}
      >
        <Icon name="pin" size={ICON_SIZE} opacity={visible ? 1 : 0.45} />
      </Pressable>
    </PulseWrap>
  );
}

export function StatusBar() {
  const hunger = useGameStore((s) => s.hunger);
  const happiness = useGameStore((s) => s.happiness);
  const tokensCollected = useGameStore((s) => s.tokensCollected);
  // The HUD-meters hint pulses all three meter pills at once (the dog
  // names what each one means in its bubble); published by Companion.
  const metersPulse = useGameStore((s) => s.activeHint) === 'map:hud-meters';
  const t = useStrings();

  return (
    // box-none so the toggle pill receives taps while the wrap itself
    // doesn't swallow gestures aimed at the map.
    // Hunger reads as % (0-100 meter, like happiness) so a +20 bump
    // is obviously "+20% fed", not "I ate 20 bones". Paw pill keeps
    // the lifetime collected count.
    <View style={styles.wrap} pointerEvents="box-none">
      <MeterPill icon="sun" value={happiness} label={t.hud.happiness} showValue={false} pulse={metersPulse} />
      <MeterPill icon="bone" value={hunger} label={t.hud.hunger} showValue={false} pulse={metersPulse} />
      <CounterPill icon="paws" value={tokensCollected} label={t.hud.paws} pulse={metersPulse} />
      <SpotsTogglePill />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.s,
  },
  pill: {
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    overflow: 'hidden',
    backgroundColor: GLASS_BG,
    shadowColor: GLASS_SHADOW_COLOR,
    // Bumped from { 0, 4 } / 0.1 / 16 to the chat CHROME_SHADOW
    // values so HUD pills feel like the same family as the chat
    // header + input cards — visibly lifted off the bg.
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 6,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.s,
    gap: S.xs,
  },
  meterPill: {
    minWidth: PILL_MIN_WIDTH,
  },
  // Kept as an alias of `pill` — used to be the opt-in solid-white
  // override when the default was translucent glass. Defaults are
  // now solid; this stays as a no-op so existing `solid` props on
  // MeterPill / CounterPill don't need a churning rename.
  pillSolid: {},
  counterPill: {
    minWidth: PILL_MIN_WIDTH,
  },
  togglePill: {
    paddingHorizontal: S.m,
  },
  // Sniff toggle's OFF state — solid muted grey so the toggle
  // still reads as inactive vs the white ON state, without
  // relying on transparency to communicate "muted".
  togglePillOff: {
    backgroundColor: '#f0f0f0',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    opacity: 0.75,
  },
  value: {
    color: colors.black,
    fontSize: TYPE.body,
    fontWeight: '700',
  },
});
