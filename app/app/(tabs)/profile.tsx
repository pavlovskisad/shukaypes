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
import { Icon } from '../../components/ui/Icon';
import { INLINE_ICON, HERO } from '../../constants/sizing';
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

  // Two swipeable sections below the hero. Language moved out
  // of the deck into a tiny UA/EN toggle inside the hero — it's
  // a setting, not a stat group, and the deck reads cleaner with
  // only homogeneous stat cards.
  const sections = useMemo(
    () => [
      {
        id: 'walks',
        content: (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t.profile.stats.walksTogether}</Text>
            <StatRow label={t.profile.stats.daysPlayed} value={data?.stats.daysPlayed} />
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
    [t, data],
  );

  const skyColor = sceneMode === 'day' ? '#dbeaf4' : '#1c2a44';
  const onDark = sceneMode === 'night';

  return (
    // Full-bleed sky background — the dog scene's landscape sits
    // at the bottom of the screen, the rest is one continuous sky
    // tinted to match the scene's mode. All UI elements (name,
    // meters, stat deck, lang toggle) float on top as overlays
    // like the HUD pills on the map tab.
    <SafeAreaView style={[styles.root, { backgroundColor: skyColor }]} edges={['top']}>
      {/* Top overlay row — companion name + level on the left, UA/
          EN toggle on the right. Sits above the sky with text
          colour adapting to day / night for contrast. */}
      <View style={styles.topRow}>
        <View style={styles.nameBlock}>
          <Text style={[styles.heroName, onDark && styles.heroNameDark]}>
            {data?.companion.name ?? companionName}
          </Text>
          <Text style={[styles.heroMeta, onDark && styles.heroMetaDark]}>
            {t.profile.level(data?.companion.level ?? 1)}
            {data && data.companion.level < data.companion.maxLevel
              ? ` · ${t.profile.xpProgress(data.companion.xpInLevel, data.companion.xpForNextLevel)}`
              : data?.companion.level === data?.companion.maxLevel
                ? ` · ${t.profile.max}`
                : ''}
          </Text>
          {data ? (
            <View
              style={[
                styles.xpBarTrack,
                onDark && { backgroundColor: 'rgba(255,255,255,0.18)' },
              ]}
              accessibilityLabel={
                data.companion.level >= data.companion.maxLevel
                  ? t.profile.a11yMaxLevel
                  : t.profile.a11yXpProgress(data.companion.xpInLevel, data.companion.xpForNextLevel)
              }
            >
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
        </View>
        <View style={styles.langTinyRow}>
          <Pressable
            onPress={() => setLang('uk')}
            accessibilityRole="switch"
            accessibilityState={{ checked: lang === 'uk' }}
            style={({ pressed }) => [
              styles.langTinyPill,
              lang === 'uk' && styles.langTinyPillActive,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.langTinyText, lang === 'uk' && styles.langTinyTextActive]}>
              UA
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setLang('en')}
            accessibilityRole="switch"
            accessibilityState={{ checked: lang === 'en' }}
            style={({ pressed }) => [
              styles.langTinyPill,
              lang === 'en' && styles.langTinyPillActive,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.langTinyText, lang === 'en' && styles.langTinyTextActive]}>
              EN
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Meters row — three floating pills directly below the name
          block. White-with-shadow chips read against any sky tint. */}
      <View style={styles.metersRow}>
        <View style={styles.meterPill}>
          <Icon name="sun" size={INLINE_ICON.stat} />
          <Text style={styles.meterValue}>
            {Math.round(data?.companion.happiness ?? 0)}%
          </Text>
        </View>
        <View style={styles.meterPill}>
          <Icon name="bone" size={INLINE_ICON.stat} />
          <Text style={styles.meterValue}>{Math.round(data?.companion.hunger ?? 0)}%</Text>
        </View>
        <View style={styles.meterPill}>
          <Icon name="paws" size={INLINE_ICON.stat} />
          <Text style={styles.meterValue}>{data?.stats.pawsCollected ?? 0}</Text>
        </View>
      </View>

      {/* Stat deck — centred between the meters and the scene's
          horizon line. No counter (kills the "2 / 2" noise — the
          stack peek already signals there's another card). */}
      <View style={styles.deckHolder}>
        <CardStack
          items={sections}
          getId={(s) => s.id}
          renderCard={(s) => s.content}
          cardHeight={180}
          showCounter={false}
        />
      </View>

      {/* Dog scene anchored at the bottom of the viewport, above
          the floating dashboard. onModeChange syncs the page bg
          to the scene's day / night mode so the sky reads as one
          continuous environment. */}
      <View style={[styles.sceneHolder, { bottom: HERO.size + insets.bottom }]}>
        {sceneActive ? (
          <ProfileDogScene onModeChange={setSceneMode} />
        ) : (
          <View style={styles.scenePlaceholder} />
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.greyBg,
  },
  // Top overlay row — name+level on the left, lang toggle on
  // the right. Lives in the upper sky portion of the page.
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  nameBlock: {
    flex: 1,
    paddingRight: 16,
  },
  // Floating meters row directly below the name block.
  metersRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },
  // Holds the stat deck. Centred horizontally, with a top
  // margin that pushes it below the meters and a bottom margin
  // that keeps it clear of the scene's horizon line.
  deckHolder: {
    alignItems: 'center',
    marginTop: 28,
  },
  // Anchors the scene at the bottom of the viewport, above the
  // floating dashboard. bottom offset is dashboard height +
  // safe-area inset (passed inline via insets.bottom).
  sceneHolder: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 200,
  },
  // Empty box that takes the scene's footprint while the scene
  // is unmounted on background tabs.
  scenePlaceholder: {
    width: '100%',
    height: 200,
  },
  // Section cards inside the deck. Width matches the hero. Padding
  // tighter than the hero's content padding since the rows have
  // their own breathing room.
  sectionCard: {
    width: CARD_W,
    height: 200,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingTop: 14,
    paddingBottom: 16,
    paddingHorizontal: 18,
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
  // Tiny UA/EN toggle in the top-right of the page (right side of
  // the topRow flex). Stays visible against any sky tint via the
  // semi-opaque white pill background.
  langTinyRow: {
    flexDirection: 'row',
    gap: 4,
  },
  langTinyPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  langTinyPillActive: {
    backgroundColor: colors.black,
    borderColor: colors.black,
  },
  langTinyText: {
    fontFamily: SYSTEM_FONT,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: '#555',
  },
  langTinyTextActive: {
    color: '#fff',
  },
  heroName: {
    fontFamily: SYSTEM_FONT,
    fontSize: 22,
    fontWeight: '800',
    color: colors.black,
  },
  // Inverted name colour for the night-mode sky.
  heroNameDark: {
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroMeta: {
    fontSize: 13,
    color: '#555',
    marginTop: 2,
    marginBottom: 8,
  },
  heroMetaDark: {
    color: 'rgba(255,255,255,0.85)',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  xpBarTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.1)',
    width: 180,
    overflow: 'hidden',
  },
  xpBarFill: {
    height: '100%',
    backgroundColor: 'rgba(0,60,255,0.85)',
    borderRadius: 2,
  },
  meterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 1,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
  },
  meterValue: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.black,
  },
  // Denser stat rows — was paddingVertical 10 + fontSize 16/20.
  // Tighter padding + smaller fonts so 5 rows comfortably fit a
  // 200-tall section card.
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
