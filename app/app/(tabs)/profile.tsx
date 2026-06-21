import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { useGameStore } from '../../stores/gameStore';
import { api } from '../../services/api';
import { ProfileDogScene } from '../../components/profile/ProfileDogScene';
import type { SceneMode } from '../../components/profile/ProfileSceneBackdrop';
import { HERO, CHIP } from '../../constants/sizing';
import { MeterPill, CounterPill } from '../../components/ui/StatusBar';
import { useStrings } from '../../i18n/useStrings';
import { useLangStore } from '../../stores/langStore';
import { CardStack, CARD_W } from '../../components/ui/CardStack';

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

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

// Small shimmer bar used in place of a stat value while the
// profile fetch is in flight. Reuses the same lost-dog-shimmer
// keyframe injected once on mount below so only one stylesheet
// is in <head> regardless of which tab the user lands on first.
function ShimmerBar({ width = 56 }: { width?: number }) {
  return (
    <View
      style={
        {
          width,
          height: 14,
          borderRadius: 7,
          backgroundColor: '#e6e6e6',
          backgroundImage:
            'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.75) 50%, transparent 70%)',
          backgroundSize: '200% 100%',
          backgroundRepeat: 'no-repeat',
          animation: 'lost-dog-shimmer 1.8s ease-in-out infinite',
        } as unknown as object
      }
    />
  );
}

function StatRow({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      {value === undefined || value === null ? (
        <ShimmerBar width={50} />
      ) : (
        <Text style={styles.statValue}>{value}</Text>
      )}
    </View>
  );
}

export default function ProfileScreen() {
  const t = useStrings();
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const companionName = useGameStore((s) => s.companionName);
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Mirror the dog scene's day / night mode so the page bg colour
  // matches its sky — gives the full-bleed look where the scene's
  // landscape sits inside one continuous sky instead of a tiny
  // 200-px strip glued to a flat-coloured page.
  const [sceneMode, setSceneMode] = useState<SceneMode>('day');
  const insets = useSafeAreaInsets();

  const refetch = useCallback(async () => {
    try {
      const fresh = (await api.getProfile()) as ProfileData | { error: string };
      if ('error' in fresh) {
        setError(fresh.error);
        return;
      }
      setData(fresh);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
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
            <Text style={styles.sectionTitle}>{t.profile.stats.companionStats}</Text>
            <Text style={styles.companionNameBig}>
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
            {data ? (
              <View style={styles.xpBarTrack}>
                <View
                  style={[
                    styles.xpBarFill,
                    {
                      width: `${
                        data.companion.level >= data.companion.maxLevel
                          ? 100
                          : Math.round(
                              (data.companion.xpInLevel /
                                Math.max(1, data.companion.xpForNextLevel)) *
                                100,
                            )
                      }%` as unknown as number,
                    },
                  ]}
                />
              </View>
            ) : null}
            <StatRow label={t.profile.stats.daysPlayed} value={data?.stats.daysPlayed} />
          </View>
        ),
      },
      {
        id: 'walks',
        content: (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t.profile.stats.walksTogether}</Text>
            <StatRow
              label={t.profile.stats.distanceWalked}
              value={data ? formatDistance(data.user.totalDistanceMeters) : undefined}
            />
            <StatRow label={t.profile.stats.pawsCollected} value={data?.stats.pawsCollected} />
            <StatRow label={t.profile.stats.bonesEaten} value={data?.stats.bonesEaten} />
          </View>
        ),
      },
      {
        id: 'helping',
        content: (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t.profile.stats.helpingPets}</Text>
            <StatRow label={t.profile.stats.petsSearched} value={data?.stats.petsSearched} />
            <StatRow
              label={t.profile.stats.searchesCompleted}
              value={data?.stats.questsCompleted}
            />
            <StatRow
              label={t.profile.stats.sightingsReported}
              value={data?.stats.sightingsReported}
            />
          </View>
        ),
      },
    ],
    [t, data, companionName],
  );

  const skyColor = sceneMode === 'day' ? '#dbeaf4' : '#1c2a44';

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
            dogBottomInset={260 + HERO.size + insets.bottom}
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
            value={data?.companion.happiness ?? 0}
            label={t.hud.happiness}
            solid
          />
          <MeterPill
            icon="bone"
            value={data?.companion.hunger ?? 0}
            label={t.hud.hunger}
            solid
          />
          <CounterPill
            icon="paws"
            value={data?.stats.pawsCollected ?? 0}
            label={t.hud.paws}
            solid
          />
        </View>
        <View style={styles.langPills}>
          <LangPill code="uk" label="UA" active={lang === 'uk'} onPress={() => setLang('uk')} />
          <LangPill code="en" label="EN" active={lang === 'en'} onPress={() => setLang('en')} />
        </View>
      </View>

      {/* Stat deck — on the lower lawn, right above the tab bar
          and below the dog. peekScale tightens the stacked-card
          peek so the deck doesn't visually dominate the smaller
          150-tall slot (the default scale was calibrated for the
          280-tall photo cards on tasks / spots). */}
      <View style={[styles.deckHolder, { bottom: HERO.size + insets.bottom }]}>
        <CardStack
          items={sections}
          getId={(s) => s.id}
          renderCard={(s) => s.content}
          cardHeight={150}
          peekScale={0.55}
          showCounter={false}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

// Tiny UA / EN pill — same frosted-glass family as the HUD
// MeterPill so the language toggle reads as one of "the
// pills" rather than a stray button. Active state inverts to
// dark fill, matching the spots-tab category-chip family.
function LangPill({
  code,
  label,
  active,
  onPress,
}: {
  code: 'uk' | 'en';
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={code === 'uk' ? 'Ukrainian' : 'English'}
      style={({ pressed }) => [
        styles.langPill,
        active && styles.langPillActive,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.langPillText, active && styles.langPillTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

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
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  hudPills: {
    flexDirection: 'row',
    gap: 6,
  },
  langPills: {
    flexDirection: 'row',
    gap: 6,
  },
  // Lang pill — solid white, same shape as the HUD MeterPill /
  // CounterPill in solid mode. The dark night sky behind would
  // tint a translucent pill, so plain white is cleaner.
  langPill: {
    height: CHIP.height,
    minWidth: CHIP.height,
    paddingHorizontal: 10,
    borderRadius: CHIP.height / 2,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langPillActive: {
    backgroundColor: colors.black,
  },
  langPillText: {
    fontFamily: SYSTEM_FONT,
    fontSize: 13,
    fontWeight: '700',
    color: colors.black,
    letterSpacing: 0.5,
  },
  langPillTextActive: {
    color: '#fff',
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
    width: CARD_W,
    height: 150,
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 6,
  },
  sectionTitle: {
    fontFamily: SYSTEM_FONT,
    fontSize: 13,
    color: '#777',
    marginBottom: 8,
    textTransform: 'lowercase',
    letterSpacing: 0.3,
  },
  // Companion identity card (first in the deck) — compact name +
  // level + xp bar + days-together row so the four elements fit
  // comfortably in the same 150-tall slot as the other 3-row cards.
  companionNameBig: {
    fontFamily: SYSTEM_FONT,
    fontSize: 19,
    fontWeight: '800',
    color: colors.black,
    marginBottom: 1,
  },
  companionLevel: {
    fontSize: 12,
    color: '#555',
    marginBottom: 6,
  },
  xpBarTrack: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(0,0,0,0.08)',
    overflow: 'hidden',
    marginBottom: 6,
  },
  xpBarFill: {
    height: '100%',
    backgroundColor: 'rgba(0,60,255,0.85)',
    borderRadius: 2.5,
  },
  // Denser stat rows for the walks / helping cards.
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  statLabel: {
    fontSize: 13,
    color: '#555',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.black,
  },
  error: {
    fontSize: 12,
    color: '#a33',
    textAlign: 'center',
    marginTop: 8,
  },
});
