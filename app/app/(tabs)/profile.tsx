import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { ERROR_TEXT, TYPE } from '../../constants/type';
import { popPressableEvent } from '../../utils/popOnTap';
import { formatDistance } from '../../utils/geo';
import { LOOP_VIEW_PROPS } from '../../utils/motion';
import { useGameStore } from '../../stores/gameStore';
import { api, type TerritoryRanking } from '../../services/api';
import { useAccessStore } from '../../stores/accessStore';
import { ProfileDogScene } from '../../components/profile/ProfileDogScene';
import { SCENE_SKY, type SceneMode } from '../../components/profile/ProfileSceneBackdrop';
import { HERO, CHIP, HUD_TOP, TAB_BAR_STRIP } from '../../constants/sizing';
import { useTabBarClearance } from '../../hooks/useTabBarClearance';
import { MeterPill, CounterPill } from '../../components/ui/StatusBar';
import { useStrings } from '../../i18n/useStrings';
import { usePwaInsetOvershoot } from '../../hooks/usePwaInsetOvershoot';
import { CardStack, DECK_OFFSET } from '../../components/ui/CardStack';
import { HandDrawnBar, HandDrawnFrame } from '../../components/ui/HandDrawn';
import { AccountEditSheet } from '../../components/ui/AccountEditSheet';
import { LangPill, pillStyles } from '../../components/ui/LangPill';

// Basic stats card for v1 — no skins grid yet (deferred). Pulls
// aggregate counts from /profile/me on focus, with the live game
// store values for hunger/happiness so the meter pills there stay
// in sync with the HUD without a second fetch.

interface ProfileData {
  user: {
    id: string;
    username: string;
    createdAt: string;
    points: number;
    totalTokens: number;
    totalDistanceMeters: number;
  };
  companion: {
    name: string;
    level: number;
    xp: number;
    xpInLevel: number;
    xpForNextLevel: number;
    maxLevel: number;
    hunger: number;
    happiness: number;
  };
  stats: {
    daysPlayed: number;
    pawsCollected: number;
    bonesEaten: number;
    petsSearched: number;
    questsCompleted: number;
    questsAbandoned: number;
    sightingsReported: number;
  };
}

// The territory board plus where the viewer stands on it. `rank` is null
// when they're outside the top ten (or hold no ground at all).
interface TerritoryBoard {
  board: TerritoryRanking[];
  you: { areaM2: number; rank: number | null };
}

// Small shimmer bar used in place of a stat value while the
// profile fetch is in flight. The `shimmer` keyframe is global, in
// public/index.html. It used to name `lost-dog-shimmer`, which
// nothing defined, so the bars sat still.
function ShimmerBar({ width = 56 }: { width?: number }) {
  return (
    <View
      {...LOOP_VIEW_PROPS}
      style={
        {
          width,
          height: 14,
          borderRadius: R.sm,
          backgroundColor: '#e6e6e6',
          backgroundImage:
            'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.75) 50%, transparent 70%)',
          backgroundSize: '200% 100%',
          backgroundRepeat: 'no-repeat',
          animation: 'shimmer 1.8s ease-in-out infinite',
        } as unknown as object
      }
    />
  );
}

// `failed`: the fetch behind this value gave up, so the row settles on a
// dash instead of shimmering for as long as the tab is open.
function StatRow({
  label,
  value,
  failed = false,
}: {
  label: string;
  value: string | number | undefined;
  failed?: boolean;
}) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      {value === undefined || value === null ? (
        failed ? (
          <Text style={styles.statValue} numberOfLines={1}>—</Text>
        ) : (
          <ShimmerBar width={50} />
        )
      ) : (
        <Text style={styles.statValue} numberOfLines={1}>
          {value}
        </Text>
      )}
    </View>
  );
}

// The «змінити» chip on the dog card: smaller than the HUD pills, it
// is a corner affordance and not a control row.
const EDIT_CHIP_H = 28;
// (44 - 28) / 2 — grows the chip's tap target to 44 without moving it.
const EDIT_CHIP_PAD = (44 - EDIT_CHIP_H) / 2;
// The pet's portrait beside its name: as tall as the name and level
// lines together. No drawn ring — the drawing's own marker line is the
// edge (the owner asked for the border dropped, 14 Sep); the same rule
// as the dog's card on the map.
const PORTRAIT_SIZE = 44;
const PORTRAIT_INSET = 0;

export default function ProfileScreen() {
  const t = useStrings();
  const companionName = useGameStore((s) => s.companionName);
  // The HUD's own live values, for the meters until /profile/me lands —
  // a 0 there read as a starving, miserable dog on every visit.
  const liveHappiness = useGameStore((s) => s.happiness);
  const liveHunger = useGameStore((s) => s.hunger);
  const livePaws = useGameStore((s) => s.tokensCollected);
  const setAboutOpen = useGameStore((s) => s.setAboutOpen);
  const avatarUrl = useAccessStore((s) => s.me?.avatarUrl ?? null);
  // The account sheet — nickname, the pet, a new password, and the way
  // out — opens from the small «змінити» chip on the dog card.
  const [editOpen, setEditOpen] = useState(false);
  // After «вийти з акаунта» in that sheet: back to the gate, where the
  // dog asks «ми знайомі?» again and, with the door up, asks the person
  // to log in (or register) before the map. A full reload rather than
  // a navigate (UX-2.11, D4): the chat transcript and the paw total in
  // memory are the account that just left, and on a shared phone the
  // next one saw both. A reload is the reset that cannot miss a store.
  const afterLogout = useCallback(() => {
    window.location.replace('/');
  }, []);
  const [data, setData] = useState<ProfileData | null>(null);
  // The last /profile/me read failed. A flag, not the message: the raw
  // exception text ("Failed to fetch", a server string) used to be
  // printed under the deck, untranslated. It goes to the console now,
  // and the page says the translated thing.
  const [failed, setFailed] = useState(false);
  // Territory standing. Its own fetch rather than a field on /profile/me
  // because the board is cached server-side on a different clock — and
  // a failure here should cost the territory card, not the whole page.
  const [board, setBoard] = useState<TerritoryBoard | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);

  // Mount the dog scene only when this tab is BOTH the focused screen
  // AND the document is visible. Without this, the scene runs forever
  // after the user's first profile visit — DogSprite frame intervals
  // (12 ticks/s on the running anim), the scene state machine, the
  // ambient-event scheduler, and CSS keyframes for clouds + bird wings
  // all keep firing on background tabs. Same recipe as the map view's
  // tab-blur pause from PR #160.
  const isFocused = useIsFocused();
  const [docVisible, setDocVisible] = useState(
    typeof document === 'undefined' ? true : !document.hidden,
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setDocVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  const sceneActive = isFocused && docVisible;
  // The edit sheet is portaled to the body, so it outlives the tab.
  // The tap-out layer keeps the bar from being tapped under it, but the
  // app can still leave the profile on its own — the door closing
  // mid-session sends it to the gate (UX-2.7), a verify sheet to the
  // map (UX-2.13) — and the sheet then floated over whatever came next.
  // Leaving the tab closes it.
  useEffect(() => {
    if (!isFocused) setEditOpen(false);
  }, [isFocused]);

  // Mirror the dog scene's day / night mode so the page bg colour
  // matches its sky — gives the full-bleed look where the scene's
  // landscape sits inside one continuous sky instead of a tiny
  // 200-px strip glued to a flat-coloured page.
  const [sceneMode, setSceneMode] = useState<SceneMode>('day');
  // The tab bar's top edge (hooks/useTabBarClearance.ts) — the same
  // inset the bar is placed with, so inside Telegram the deck no longer
  // pads for an iOS strip the bar itself ignores.
  const tabClearance = useTabBarClearance();
  // Installed-PWA root is extended down by the bottom inset so the scene
  // bleeds through the home-indicator strip; lift the floating deck back
  // up by the same amount. 0 in browser / TG. See usePwaInsetOvershoot.
  const pwaOvershoot = usePwaInsetOvershoot();

  const refetch = useCallback(async () => {
    try {
      const fresh = (await api.getProfile()) as ProfileData | { error: string };
      if ('error' in fresh) {
        console.warn('[profile] load failed:', fresh.error);
        setFailed(true);
        return;
      }
      setData(fresh);
      setFailed(false);
    } catch (err) {
      console.warn('[profile] load failed:', err);
      setFailed(true);
    }
    // Territory is a separate trip and a separate failure: if the board
    // is unreachable the card just shows dashes, and the rest of the
    // profile is unaffected. A board already read stays up.
    try {
      setBoard(await api.territoryLeaderboard());
      setBoardFailed(false);
    } catch {
      setBoardFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      useGameStore.getState().setScreen('profile');
      void refetch();
    }, [refetch])
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Three swipeable sections — first one is the companion
  // identity card (name + level + xp + days-together). Lucky paw
  // dropped on user request; days-together moved out of the walks
  // card so all three cards end up with the same "title + 3 quick
  // stats" rhythm.
  const sections = useMemo(
    () => [
      {
        id: 'companion',
        content: (
          <View style={styles.sectionCard}>
            <HandDrawnFrame radius={R.card} />
            {/* «змінити» — the one way into the account sheet. A chip in
                the card's corner rather than a pill on the sky: it is
                about this card's dog and this card's person. */}
            <Pressable
              onPress={() => setEditOpen(true)}
              onPressIn={popPressableEvent}
              accessibilityRole="button"
              accessibilityLabel={t.auth.editChip}
              style={({ pressed }) => [styles.editChipHit, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.editChip}>
                <HandDrawnFrame radius={R.label} />
                <Text style={styles.editChipText}>{t.auth.editChip}</Text>
              </View>
            </Pressable>
            <Text style={styles.sectionTitle}>{t.profile.stats.companionStats}</Text>
            <View style={styles.companionRow}>
              {/* The pet's portrait (D-72), when one has been drawn:
                  a small round one beside the name, no ring. */}
              {avatarUrl ? (
                <View style={styles.portrait}>
                  <Image
                    source={{ uri: avatarUrl }}
                    style={styles.portraitImage}
                    accessibilityLabel={t.auth.avatarSection}
                  />
                </View>
              ) : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.companionNameBig} numberOfLines={1}>
                  {data?.companion.name ?? companionName}
                </Text>
                <Text style={styles.companionLevel}>
                  {t.profile.level(data?.companion.level ?? 1)}
                  {data && data.companion.level < data.companion.maxLevel
                    ? ` · ${t.profile.xpProgress(data.companion.xpInLevel, data.companion.xpForNextLevel)}`
                    : data?.companion.level === data?.companion.maxLevel
                      ? ` · ${t.profile.max}`
                      : ''}
                </Text>
              </View>
            </View>
            {data ? (
              <View style={styles.xpBarTrack}>
                <HandDrawnBar
                  seed="xp"
                  height={5}
                  progress={
                    data.companion.level >= data.companion.maxLevel
                      ? 1
                      : data.companion.xpInLevel /
                        Math.max(1, data.companion.xpForNextLevel)
                  }
                />
              </View>
            ) : null}
            <StatRow label={t.profile.stats.daysPlayed} value={data?.stats.daysPlayed} failed={failed} />
          </View>
        ),
      },
      {
        id: 'walks',
        content: (
          <View style={styles.sectionCard}>
            <HandDrawnFrame radius={R.card} />
            <Text style={styles.sectionTitle}>{t.profile.stats.walksTogether}</Text>
            <StatRow
              label={t.profile.stats.distanceWalked}
              value={data ? formatDistance(data.user.totalDistanceMeters, t.units, { snap: false }) : undefined}
              failed={failed}
            />
            <StatRow label={t.profile.stats.pawsCollected} value={data?.stats.pawsCollected} failed={failed} />
            <StatRow label={t.profile.stats.bonesEaten} value={data?.stats.bonesEaten} failed={failed} />
          </View>
        ),
      },
      {
        id: 'territory',
        content: (
          <View style={styles.sectionCard}>
            <HandDrawnFrame radius={R.card} />
            <Text style={styles.sectionTitle}>{t.profile.stats.territory}</Text>
            <StatRow
              label={t.profile.stats.territoryArea}
              value={board ? t.profile.areaValue(board.you.areaM2) : undefined}
              failed={boardFailed}
            />
            <StatRow
              label={t.profile.stats.territoryRank}
              value={
                board
                  ? board.you.rank != null
                    ? t.profile.rankValue(board.you.rank)
                    : t.profile.unranked
                  : undefined
              }
              failed={boardFailed}
            />
            {/* Who's ahead. One name is enough on a card this size — the
                point is "someone holds more than you", not a full board. */}
            <StatRow
              label={t.profile.stats.territoryTop}
              value={
                board
                  ? board.board.length
                    ? `${board.board[0]!.name} · ${t.profile.areaValue(board.board[0]!.areaM2)}`
                    : t.profile.unranked
                  : undefined
              }
              failed={boardFailed}
            />
          </View>
        ),
      },
      {
        id: 'helping',
        content: (
          <View style={styles.sectionCard}>
            <HandDrawnFrame radius={R.card} />
            <Text style={styles.sectionTitle}>{t.profile.stats.helpingPets}</Text>
            <StatRow label={t.profile.stats.petsSearched} value={data?.stats.petsSearched} failed={failed} />
            <StatRow
              label={t.profile.stats.searchesCompleted}
              value={data?.stats.questsCompleted}
              failed={failed}
            />
            <StatRow
              label={t.profile.stats.sightingsReported}
              value={data?.stats.sightingsReported}
              failed={failed}
            />
          </View>
        ),
      },
    ],
    [t, data, failed, board, boardFailed, companionName, avatarUrl],
  );

  const skyColor = SCENE_SKY[sceneMode];
  // Where the floating stat deck sits, and therefore where the lawn the
  // dog walks on runs out. Named once because three things need to agree
  // on it: the deck's own offset, the card height it renders at, and the
  // floor the dog scene is not allowed to sink below.
  // HERO.size above the inset is where it has always sat: 18 px lower
  // than the bar's top edge, with the deck's own 24 px bottom margin
  // (CardStack) lifting the cards clear of it. Written against the bar
  // so the two cannot drift apart again.
  const deckBottom = tabClearance - TAB_BAR_STRIP + HERO.size + pwaOvershoot;

  return (
    // Full-bleed scene: the dog's habitat takes the entire screen
    // behind the HUD. Sky tint matches the scene's day / night
    // mode so the background reads as one continuous environment.
    // The dog ambles along the bottom (above the tab bar); cards
    // float on the lawn area below the horizon.
    <SafeAreaView style={[styles.root, { backgroundColor: skyColor }]} edges={['top']}>
      {/* Full-screen scene — anchored to fill from the top to the
          top of the floating dashboard. SVG layers stretch with
          preserveAspectRatio="none" so the horizon lands around
          the middle of the screen. */}
      <View style={styles.sceneFullBleed}>
        {sceneActive ? (
          // Scene extends ALL the way to the viewport bottom (behind
          // the tab bar) so the lawn colour bleeds under the
          // dashboard's rounded top corners — otherwise the page bg
          // shows through there as a visible band of mismatched
          // colour. dogBottomInset compensates for the extra height
          // so the dog still walks just below the horizon (260 +
          // tab-bar inset).
          <ProfileDogScene
            onModeChange={setSceneMode}
            dogBottomInset={260 + deckBottom}
            // Top edge of the stat deck. The scene keeps the dog above
            // it, so a short viewport can never park the dog behind a
            // card — see groundInset in ProfileDogScene.
            // DECK_OFFSET: the deck's own padding and margin sit
            // between deckBottom and the cards (UX-12.10).
            dogFloorInset={deckBottom + DECK_OFFSET + DECK_CARD_H}
          />
        ) : null}
      </View>

      {/* HUD overlay — three meter pills + UA/EN toggle, same
          frosted-glass family as the map tab's status bar. Sits
          at the very top of the screen so the sky around the
          dog stays uncluttered. */}
      <View style={styles.hudRow}>
        <View style={styles.hudPills}>
          <MeterPill
            icon="sun"
            value={data?.companion.happiness ?? liveHappiness}
            label={t.hud.happiness}
            solid
            showValue={false}
          />
          <MeterPill
            icon="bone"
            value={data?.companion.hunger ?? liveHunger}
            label={t.hud.hunger}
            solid
            showValue={false}
          />
          <CounterPill
            icon="paws"
            value={data?.stats.pawsCollected ?? livePaws}
            label={t.hud.paws}
            solid
          />
        </View>
        <View style={styles.langPills}>
          {/* The switch itself is a component now — the gate shows the
              same pill, and two copies is how the first one drifts
              (D-96). Why it is one pill rather than two lives there. */}
          <LangPill />
          {/* The about sheet lives here. It used to hang off the
              companion's ring as a «?», and when that ring was cut down
              to the three things you can do on a walk, «what is this
              app» had nowhere left to be reached from — the sheet was
              still built, still translated, and unreachable.

              Back on the top row now that the language toggle is one
              pill and there is room. It borrows that pill's styling, but
              it is a button rather than a switch. */}
          <Pressable
            onPress={() => setAboutOpen(true)}
            onPressIn={popPressableEvent}
            accessibilityRole="button"
            accessibilityLabel={t.modals.about.header}
            style={({ pressed }) => [pillStyles.pill, pressed && { opacity: 0.7 }]}
          >
            <HandDrawnFrame radius={CHIP.height / 2} />
            <Text style={pillStyles.text}>?</Text>
          </Pressable>
        </View>
      </View>

      {/* Stat deck — on the lower lawn, right above the tab bar
          and below the dog. Same horizontal carousel calibration
          as tasks / spots (peekScale 1) — the cards stay 320 wide
          here too, so a smaller STEP collapses the peeks under
          the centre card. */}
      <View style={[styles.deckHolder, { bottom: deckBottom }]}>
        <CardStack
          items={sections}
          getId={(s) => s.id}
          renderCard={(s) => s.content}
          cardHeight={DECK_CARD_H}
          showCounter={false}
        />
      </View>

      {/* Only when there is nothing to show: with an earlier read on
          screen, a failed refresh changes nothing the page says, and the
          connection banner already covers being offline. The line is
          the retry. */}
      {failed && !data ? (
        <Pressable onPress={() => void refetch()} accessibilityRole="button">
          <Text style={styles.error}>{t.connection.loadFailed}</Text>
        </Pressable>
      ) : null}
      {editOpen ? (
        <AccountEditSheet onClose={() => setEditOpen(false)} onSaved={() => void refetch()} onLoggedOut={afterLogout} />
      ) : null}
    </SafeAreaView>
  );
}

// Height of one stat card, shared by the deck and by the dog scene's
// floor calculation.
const DECK_CARD_H = 150;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Sky bg set inline based on scene mode.
  },
  // Full-bleed scene — fills the entire SafeAreaView area, INCLUDING
  // behind the floating tab bar. The lawn colour shows through the
  // bar's rounded top corners instead of mismatching against the
  // page bg. Dog positioning is compensated via dogBottomInset so
  // the dog still walks above the bar.
  sceneFullBleed: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // HUD row at the top — meters on the left, language toggle
  // on the right. Same horizontal-padding rhythm as the map's
  // status bar so the two tabs share a "things float on top of
  // the world" identity.
  hudRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: S.m,
    // The map's pill line, not a number of its own: the same three
    // pills sat ~18 px higher here and jumped on every tab switch
    // (UX-12.3).
    paddingTop: HUD_TOP,
    gap: S.s,
  },
  hudPills: {
    flexDirection: 'row',
    // At 320 px the three meters and the two chips on the right do not
    // fit one line; the meters wrap under each other rather than run
    // under the language pill (UX-12.2).
    flexWrap: 'wrap',
    flexShrink: 1,
    minWidth: 0,
    gap: S.s,
  },
  // Just the row. The pill shape itself is pillStyles in LangPill.tsx,
  // shared with the gate's switch so the two cannot drift.
  langPills: {
    flexDirection: 'row',
    gap: S.s,
  },
  // The chip is 28 tall; the Pressable around it is the 44px tap
  // target. The pad is taken back out of the corner offset so the chip
  // itself lands exactly where it always did. (hitSlop was the obvious
  // tool and does nothing on react-native-web 0.19 — UX-9.1.)
  editChipHit: {
    position: 'absolute',
    top: S.m - EDIT_CHIP_PAD,
    right: S.m - EDIT_CHIP_PAD,
    padding: EDIT_CHIP_PAD,
    zIndex: 1,
  },
  editChip: {
    height: EDIT_CHIP_H,
    paddingHorizontal: S.m,
    // R.label, not a capsule: it sits ON the card, so it is a small
    // piece of the same paper with a tighter corner (radius.ts, UX-10.6).
    borderRadius: R.label,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  editChipText: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.small,
    fontWeight: '700',
    color: colors.black,
  },
  // Deck holder — absolute positioned over the lawn (lower
  // portion of the scene, below the horizon line). bottom
  // offset set inline so the cards float just above the dog.
  deckHolder: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  // Section cards inside the deck — height matches the deck's
  // cardHeight prop (150 on profile). Tight paddings since
  // each card has a title + 3 short lines.
  sectionCard: {
    // The slot's width, not CARD_W: the deck narrows on a phone under
    // ~370 px (UX-12.15) and a fixed 320 would hang out of it.
    width: '100%',
    height: 150,
    backgroundColor: '#ffffff',
    borderRadius: R.card,
    // Same paper as the pet and spot cards. These were the last white
    // surfaces still floating on shadow alone, and against the profile
    // scene's flat green field a shadow does almost nothing — the card
    // read as a lighter patch of grass rather than as a card. Drawn
    // edge, like the rest of the paper — see HandDrawnFrame above.
    paddingTop: S.m,
    paddingBottom: S.m,
    paddingHorizontal: S.l,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 6,
  },
  // Section titles on the same token as the tasks / spots card
  // titles (TYPE.title, 700, colours.black) — the comment always said
  // they matched and the size was 15 (UX-11.5). Measured in Annex: the
  // title's line is 20 (was 18), so the tallest card, the companion one
  // with a portrait, comes to 147 of its 150; the stat cards to 134.
  sectionTitle: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.title,
    fontWeight: '700',
    color: colors.black,
    marginBottom: S.m,
    textTransform: 'lowercase',
    letterSpacing: 0.2,
  },
  // Companion identity card (first in the deck) — compact name +
  // level + xp bar + days-together row so the four elements fit
  // comfortably in the same 150-tall slot as the other 3-row cards.
  companionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.m,
  },
  portrait: {
    width: PORTRAIT_SIZE,
    height: PORTRAIT_SIZE,
    borderRadius: PORTRAIT_SIZE / 2,
    backgroundColor: '#ffffff',
    marginBottom: S.s,
  },
  portraitImage: {
    position: 'absolute',
    top: PORTRAIT_INSET,
    left: PORTRAIT_INSET,
    right: PORTRAIT_INSET,
    bottom: PORTRAIT_INSET,
    borderRadius: PORTRAIT_SIZE / 2 - PORTRAIT_INSET,
  },
  companionNameBig: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.title,
    fontWeight: '700',
    color: colors.black,
    marginBottom: 1,
  },
  companionLevel: {
    fontSize: TYPE.small,
    color: colors.grey,
    marginBottom: S.s,
  },
  // Just the row the bar is drawn into — track and fill are both
  // strokes inside it. See HandDrawnBar.
  xpBarTrack: {
    height: 5,
    marginBottom: S.s,
  },
  // Denser stat rows for the walks / helping cards.
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: S.xs,
  },
  // The label keeps its width and the value gives way: a long value
  // (the territory leader's name + area) ellipsizes on one line instead
  // of spilling out of the fixed-height card (UX-11.7).
  statLabel: {
    fontSize: TYPE.small,
    color: colors.grey,
    flexShrink: 0,
  },
  statValue: {
    fontSize: TYPE.body,
    fontWeight: '700',
    color: colors.black,
    flexShrink: 1,
    minWidth: 0,
    marginLeft: S.s,
    textAlign: 'right',
  },
  error: {
    ...ERROR_TEXT,
    textAlign: 'center',
    marginTop: S.s,
  },
});
