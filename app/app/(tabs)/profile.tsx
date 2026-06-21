import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { useGameStore } from '../../stores/gameStore';
import { api } from '../../services/api';
import { ProfileDogScene } from '../../components/profile/ProfileDogScene';
import { Icon } from '../../components/ui/Icon';
import { INLINE_ICON } from '../../constants/sizing';
import { useStrings } from '../../i18n/useStrings';
import { useLangStore } from '../../stores/langStore';
import { CardStack, CARD_W, CARD_H } from '../../components/ui/CardStack';

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

  // Three swipeable sections below the hero. Each is its own card,
  // sized to fit the CardStack's CARD_W × CARD_H slot. The deck
  // cycles between them in either direction with the same swipe
  // mechanics as the tasks / spots stacks.
  const sections = useMemo(
    () => [
      {
        id: 'walks',
        content: (
          <View style={styles.sectionCard}>
            <Text style={styles.cardTitle}>{t.profile.stats.walksTogether}</Text>
            <StatRow label={t.profile.stats.daysPlayed} value={data?.stats.daysPlayed} />
            <StatRow
              label={t.profile.stats.distanceWalked}
              value={data ? formatDistance(data.user.totalDistanceMeters) : undefined}
            />
            <StatRow label={t.profile.stats.pawsCollected} value={data?.stats.pawsCollected} />
            <StatRow label={t.profile.stats.bonesEaten} value={data?.stats.bonesEaten} />
            <StatRow label={t.profile.stats.points} value={data?.user.points} />
          </View>
        ),
      },
      {
        id: 'helping',
        content: (
          <View style={styles.sectionCard}>
            <Text style={styles.cardTitle}>{t.profile.stats.helpingPets}</Text>
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
      {
        id: 'language',
        content: (
          <View style={styles.sectionCard}>
            <Text style={styles.cardTitle}>{t.profile.language.label}</Text>
            <View style={styles.langRow}>
              <Pressable
                onPress={() => setLang('uk')}
                accessibilityRole="switch"
                accessibilityState={{ checked: lang === 'uk' }}
                style={({ pressed }) => [
                  styles.langPill,
                  lang === 'uk' && styles.langPillActive,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.langPillText, lang === 'uk' && styles.langPillTextActive]}>
                  {t.profile.language.uk}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setLang('en')}
                accessibilityRole="switch"
                accessibilityState={{ checked: lang === 'en' }}
                style={({ pressed }) => [
                  styles.langPill,
                  lang === 'en' && styles.langPillActive,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.langPillText, lang === 'en' && styles.langPillTextActive]}>
                  {t.profile.language.en}
                </Text>
              </Pressable>
            </View>
          </View>
        ),
      },
    ],
    [t, data, lang, setLang],
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Companion card — name, level, mood. */}
        <View style={styles.card}>
          {/* Live pixel-art companion in place of the 🐶 emoji.
              Cycles sitting / lying / walking / sniffing / running
              and slides across the card during moving anims.
              Mounts only while the tab is focused + document visible
              (see sceneActive above) — unmount tears down all the
              scene's intervals + keyframe animations cleanly. */}
          {sceneActive ? <ProfileDogScene /> : <View style={styles.scenePlaceholder} />}
          <Text style={styles.companionName}>{data?.companion.name ?? companionName}</Text>
          <Text style={styles.companionMeta}>
            {t.profile.level(data?.companion.level ?? 1)}
            {data && data.companion.level < data.companion.maxLevel
              ? ` · ${t.profile.xpProgress(data.companion.xpInLevel, data.companion.xpForNextLevel)}`
              : data?.companion.level === data?.companion.maxLevel
                ? ` · ${t.profile.max}`
                : ''}
          </Text>
          {data ? (
            <View
              style={styles.xpBarTrack}
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
          <View style={styles.meterRow}>
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
        </View>

        {/* Section deck — swipeable Tinder-style stack of the
            "walks together", "helping pets" and "language" sub-
            cards. Sits below the always-visible companion hero so
            the user discovers other sections by swiping left /
            right instead of scrolling down a long list. */}
        <CardStack
          items={sections}
          getId={(s) => s.id}
          renderCard={(s) => s.content}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.greyBg,
  },
  langRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  langPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 16,
    // White-with-shadow chip (same family as spots rows + modal
    // category labels) for the unselected state. Active state
    // below swaps to dark fill so the selection still reads.
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 1,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
    alignItems: 'center',
  },
  langPillActive: {
    backgroundColor: colors.black,
  },
  langPillText: {
    fontFamily: SYSTEM_FONT,
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
  },
  langPillTextActive: {
    color: '#fff',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 100,
    gap: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
    // Clip the profile scene's full-bleed sky to the rounded
    // corners — otherwise the sky bleeds past the rounded top edges.
    overflow: 'hidden',
  },
  // One section card inside the deck below the hero. Fixed
  // dimensions matching CARD_W × CARD_H so each section fills its
  // slot exactly. Same visual shadow/radius/bg family as the
  // hero card and the dog / spot cards on other tabs.
  sectionCard: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingTop: 16,
    paddingBottom: 20,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 6,
  },
  cardTitle: {
    fontFamily: SYSTEM_FONT,
    fontSize: 14,
    color: '#777',
    marginBottom: 10,
    textTransform: 'lowercase',
    letterSpacing: 0.3,
  },
  // Empty box that occupies the same footprint as ProfileDogScene so
  // the card layout doesn't shift while the scene is unmounted on
  // background tabs. Numbers mirror the scene's outer container —
  // height 200, marginTop -18 / marginLeft -18 / marginBottom -4 to
  // break out of the card's 18px padding and sit flush at the top.
  scenePlaceholder: {
    width: 'calc(100% + 36px)' as unknown as number,
    height: 200,
    marginTop: -18,
    marginLeft: -18,
    marginBottom: -4,
    backgroundColor: '#dbeaf4',
  },
  companionName: {
    fontFamily: SYSTEM_FONT,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },
  companionMeta: {
    fontSize: 13,
    color: '#777',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 8,
  },
  xpBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginHorizontal: 24,
    marginBottom: 14,
    overflow: 'hidden',
  },
  xpBarFill: {
    height: '100%',
    backgroundColor: 'rgba(0,60,255,0.85)',
    borderRadius: 3,
  },
  meterRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  meterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    // White with shadow + hairline border — same chip family the
    // spots rows / modal category tag / lang toggle use. Was a
    // pale-blue tint that competed with the white card bg.
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 1,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
  },
  meterEmoji: {
    fontSize: 14,
  },
  meterValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.black,
  },
  // Roomier stat rows with stronger value/label hierarchy — values
  // pop, labels stay quiet at the same hue.
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  statLabel: {
    fontSize: 16,
    color: '#555',
  },
  statValue: {
    fontSize: 20,
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
