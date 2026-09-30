import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useGameStore } from '../../stores/gameStore';
import { colors } from '../../constants/colors';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { INK, SURFACE } from '../../constants/surface';
import { useStrings } from '../../i18n/useStrings';
import { popPressableEvent } from '../../utils/popOnTap';
import { HandDrawnFrame } from './HandDrawn';
import { Icon } from './Icon';
import { CLOSE_GLYPH } from '../../constants/buttons';
import { INLINE_ICON } from '../../constants/sizing';

// Active-quest indicator. Renders nothing when no quest is live; when
// one is, shows a pill with pet name + progress (2/3) + an X to abandon.
// Matches the frosted-glass recipe used on the status bar so it reads
// as part of the same HUD family.

const GLASS_BG = SURFACE.fill;

// How long the × stays armed after its first tap. Long enough to read
// "sure? tap again" and press it; short enough that a brush against it
// on the way to something else has lapsed by the time it happens again.
const ARM_MS = 3000;

export function QuestPill() {
  const activeQuest = useGameStore((s) => s.activeQuest);
  const lostDogs = useGameStore((s) => s.lostDogs);
  const abandon = useGameStore((s) => s.abandonActiveQuest);

  const t = useStrings();

  // TWO TAPS TO ABANDON (UX-7.1). This × is the only way out of a
  // search now that the map's own "abandon quest" pill is gone, and one
  // stray tap used to drop somebody's lost-pet search on the spot. The
  // first tap arms it and says so; the second, within ARM_MS, abandons.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const tm = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(tm);
  }, [armed]);
  // A new quest, or none, starts disarmed.
  const questId = activeQuest?.id;
  useEffect(() => {
    setArmed(false);
  }, [questId]);

  if (!activeQuest) return null;

  const dog = activeQuest.dogId
    ? lostDogs.find((d) => d.id === activeQuest.dogId)
    : null;
  const name = dog?.name ?? '';
  const total = activeQuest.waypoints.length;
  const done = Math.min(activeQuest.currentWaypoint, total);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.pill}>
        <HandDrawnFrame radius={R.card} />
        {/* The drawn magnifier from the icon set, not the 🔍 emoji
            (UX-9.17): the emoji is a different picture on every OS and
            nobody's drawing. */}
        <Icon name="search" size={INLINE_ICON.secondary} />
        {/* Wraps to multiple lines on long pet names instead
            of truncating — the pill grows vertically and the
            close X stays inside the row (centred on the
            text block). flexShrink + minWidth:0 lets the
            wrap actually kick in inside a flex row. */}
        <Text style={styles.label}>
          {t.hud.findingPet(name)}
        </Text>
        <Text style={styles.progress}>
          {done}/{total}
        </Text>
        <Pressable
          onPress={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            setArmed(false);
            void abandon();
          }}
          onPressIn={popPressableEvent}
          accessibilityLabel={armed ? t.hud.abandonSearchArmed : t.hud.abandonSearch}
          style={styles.closeHit}
        >
          {armed ? (
            <View style={styles.closeArmed}>
              <Text style={styles.closeArmedTxt}>{t.hud.abandonSearchArmed}</Text>
            </View>
          ) : (
            // The shared close glyph (D9). Not the full close CIRCLE:
            // this one sits inside a one-line chip, and a 44px disc
            // would double the chip's height. The 44 hit box is here.
            <Text style={styles.closeTxt}>{CLOSE_GLYPH}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Side gutters so the pill can never extend to the
    // viewport edge — combined with the label's truncation,
    // the close X always stays inside the touch area.
    paddingHorizontal: S.l,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.s,
    // Height is content-driven (paddingVertical sets the
    // single-line floor; multi-line names grow the pill).
    // CHIP.height (48) was a fixed cap and clashed with
    // wrapping labels.
    paddingVertical: S.s,
    // R.card, not CHIP.radius. CHIP.radius is half of a 48px chip, so
    // it is a capsule only while this pill stays one line — and this
    // pill's height is content-driven precisely so long pet names can
    // wrap. At two lines a 24 radius on a ~70px box is neither a
    // capsule nor the family corner. It wraps, so it is a surface.
    borderRadius: R.card,
    paddingLeft: S.l,
    paddingRight: S.s,
    backgroundColor: GLASS_BG,
    // Drawn edge — see HandDrawnFrame above.
    // Cap the pill width so a long pet name wraps inside
    // the cap instead of pushing the close button off-screen.
    maxWidth: '100%',
    flexShrink: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 3,
  },
  label: {
    color: colors.black,
    fontSize: TYPE.small,
    fontWeight: '600',
    // flexShrink + minWidth 0 is the standard "let me
    // ellipsize inside a flex row" trick. Without minWidth 0
    // the label refuses to shrink below its content's
    // natural width.
    flexShrink: 1,
    minWidth: 0,
  },
  progress: {
    color: colors.black,
    fontSize: TYPE.small,
    fontWeight: '800',
    marginLeft: 2,
  },
  // The hit box is 44 tall and at least 44 wide; the drawn × and the
  // armed capsule inside it stay 26. hitSlop used to do this job and
  // does nothing on react-native-web 0.19 (UX-9.1), so the box is real
  // and the negative vertical margin (44 - 26 = 18, half each side)
  // keeps it from growing the pill.
  closeHit: {
    minWidth: 44,
    height: 44,
    marginVertical: -9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeTxt: {
    color: colors.grey,
    fontSize: TYPE.hero,
    lineHeight: 22,
    fontWeight: '400',
  },
  // The armed ×: a small inked capsule with the question in it, so the
  // second tap has something that plainly reads as "yes, stop".
  closeArmed: {
    height: 26,
    paddingHorizontal: S.s,
    borderRadius: R.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: INK,
  },
  closeArmedTxt: {
    color: '#ffffff',
    fontSize: TYPE.small,
    fontWeight: '600',
  },
});
