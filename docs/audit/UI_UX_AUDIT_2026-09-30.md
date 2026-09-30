# шукайпес UI/UX consistency audit: report and fix plan

Date: 2026-09-30 · Scope: `app/` (Expo / react-native-web PWA and Telegram Mini App) · Status: **report only, nothing fixed yet**

---

## 1. Summary

### What ran

| Pass | Status |
|---|---|
| Code audit, 8 dimensions (typography, spacing-borders, z-index, dismissal-state, user-paths, layout-responsive, consistency-patterns, a11y-interaction) | Ran. Every finding went through a separate verifier. |
| Verification pass | Ran for every finding. **0 unverified** (no verifier died). |
| Runtime screenshot pass (`dim = runtime`) | **Ran, but with partial coverage (see below).** |

> **RUNTIME PASS: PARTIAL COVERAGE. READ THIS.**
> The screenshot pass ran headless at 320x640 and 375x812. For most of it, **the API was unreachable** from the browser: `Failed to fetch` shows on chat and profile, the offline banner is up, the supersniff deck is empty, and map tiles were blocked in one run.
> The runtime pass therefore checked the offline/degraded paths and the static chrome. It **did not look at any screen populated with real data**: no lost-pet cards, spots, boards, posts or quests.
> Everything about populated screens in this report comes from **reading the code**. None of it was seen rendered. Treat "nothing found at runtime on screen X" as "screen X was not checked at runtime", not as "screen X is fine".
> a11y-interaction-1 (marker taps leaking into the map click) was also confirmed from code only, never on a device.

### Counts (raw verified findings, before merging duplicates)

| Dimension | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|---|
| typography | 0 | 5 | 18 | 24 | 47 |
| spacing-borders | 0 | 4 | 21 | 25 | 50 |
| z-index | 0 | 2 | 12 | 13 | 27 |
| dismissal-state | 0 | 10 | 17 | 9 | 36 |
| user-paths | 0 | 12 | 29 | 13 | 54 |
| layout-responsive | 0 | 5 | 15 | 12 | 32 |
| consistency-patterns | 0 | 10 | 21 | 24 | 55 |
| a11y-interaction | 0 | 8 | 19 | 24 | 51 |
| runtime | 1 | 1 | 6 | 1 | 9 |
| **Total confirmed** | **1** | **57** | **158** | **145** | **361** |
| Refuted by verifier | | | | | 13 |
| Unverified | | | | | 0 |

Many of the 361 describe the same defect from different dimensions. Section 2 merges them into **201 themed items** (1 P0, 34 P1, 85 P2, 81 P3). Each merged item takes the highest severity among its sources and lists every source ID and file:line.

### The worst ten (short version)

1. **P0**: if the map fails to load at start-up, the app has no navigation at all (UX-2.1).
2. **P1, production data**: end-of-search "yes/no" and "I've seen" can be double-tapped, and each tap writes a real `sightings` row (UX-1.1, UX-1.2).
3. **P1, production data**: the lost-pet report form keeps the last report and can be dismissed mid-submit, which invites duplicate public reports (UX-1.3).
4. **P1, production data**: the lost pet's "last seen" pin is saved from the midpoint of a tilted map, not from under the crosshair (UX-1.4).
5. **P1, production data**: tapping ✕ mid-search offers only "no, nobody" or "yes, I saw it", with no way to keep going (UX-1.5), and a failed report is still shown as "logged!" (UX-1.6).
6. **P1**: tapping the glowing quest waypoint completes that step from anywhere, because the server honours `force` for every caller (UX-1.7).
7. **P1**: while the lost-pet pin step is open, the tab bar stays live, so the crosshair and confirm card follow the user onto other tabs (UX-2.2).
8. **P1**: there is no Android/Telegram back handling, so back closes the whole Mini App and a half-typed report is lost (UX-2.5).
9. **P1**: large parts of the Ukrainian UI speak English: sighting results, dog ring lines, cluster labels, poke toast, chat typing, quest history (theme 4).
10. **P1**: the chat send spinner is white on a white button (six dimensions reported this independently) (UX-3.1).

---

## 2. Findings by theme

Each item gives: **merged ID, severity, title**; the source finding IDs; where it is (file:line, paths relative to `app/`); the symptom; the fix. Where a verifier corrected the original finding, the corrected version is used and noted.

### Theme 1: Real-data writes and data integrity

This theme comes first because of CLAUDE.md: sightings, lost pets and users are real people's data.

#### UX-1.1 · P1 · End-of-search yes/no answers can be tapped twice and file duplicate sightings plus paws
- Sources: dismissal-state-1, a11y-interaction-22
- Where: `components/map/MapView.tsx:4092`, `:4099`, `:1865-1897` (finishSearch); `components/map/DogPrompt.tsx:80-82`; server `routes/sightings.ts:228+` (no dedupe, 30/min limit)
- Symptom: on a slow connection the prompt buttons stay live while `api.finishSearch` is in flight. A second tap, or "yes" followed by "no", writes two or contradictory rows and pays paws twice.
- Fix: add a `finishingRef` guard at the top of finishSearch (reset in `finally`), and clear or replace the prompt before the await so the pills unmount. Optionally thread a `disabled` flag through DogPrompt.

#### UX-1.2 · P1 · "I've seen" files a sighting on one tap, and a double tap files two
- Sources: a11y-interaction-2, dismissal-state-19, user-paths-11
- Where: `components/ui/LostDogModal.tsx:350-353`, `:240` (pointerEvents stay `auto` while closing); `utils/popOnTap.ts:51-57` (120 ms defer); `components/map/MapView.tsx:4576-4581`; `stores/gameStore.ts:1478`, `:1487`; server `routes/sightings.ts:81-160`, `:132`
- Symptom: one stray tap records a sighting at the current GPS position and can move a real pet's public pin. A second tap within about 360 ms records it twice. There is no undo.
- Fix: add a `firedRef` in LostDogModal (reset when `renderDog.id` changes), set `pointerEvents: closing ? 'none' : 'auto'`, and keep an `inFlight` Set per dogId in `gameStore.reportSighting`. **DECISION NEEDED:** whether to add a confirm step ("saw {name} here, just now?") using the existing DogPrompt.

#### UX-1.3 · P1 · Lost-pet report form: can close mid-submit, then shows a stale "done" screen, and keeps the previous pet's data
- Sources: dismissal-state-2, dismissal-state-4, user-paths-3, user-paths-29, a11y-interaction-3
- Where: `components/ui/LostFlowModal.tsx:151-162` (close timer resets only step/error/sending/result), `:131-137` (fields never cleared), `:202-230` (submit has no cancellation), `:319` (backdrop), `:564`, `:571`, `:574` (close pills live while sending); mounted without a key at `app/(tabs)/index.tsx:267`
- Symptom: closing during "sending…" does not cancel the request. The report still publishes, and the next open lands on the "done" screen. If the user reopens before it lands, the form is re-enabled and can post a duplicate public report. After a successful report, the old name, description, phone, photo and pin are prefilled.
- Fix: `onClick={sending ? undefined : onClose}` on the backdrop and both close pills, plus `disabled={sending}`. Add an `openGenRef`/request id so submit ignores responses that arrive after close. Clear species/name/desc/phone/photo/pin after a successful submit, but keep an abandoned draft.

#### UX-1.4 · P1 · The pet's "last seen" pin is saved from the map-bounds midpoint, not from under the crosshair
- Sources: dismissal-state-18, layout-responsive-17
- Where: `components/ui/LostFlowModal.tsx:298-299` (reads `viewportCenter`), `:240-245` (crosshair at 50%/50% of window); `components/map/MapView.tsx:1258-1263` (viewportCenter = bounds midpoint), `:1405-1466` (chase loop ignores `lostPinning`), `:1501`, `:1560`, `:3030-3039`, `:3193-3205`, `:3230`; `components/map/Companion.tsx:625-634` (mode:lost does not leave search mode)
- Symptom: the map is tilted in every mode (pitch 65-70), so the bounds midpoint sits far up-screen of the crosshair. The report lands on the wrong street, possibly hundreds of metres off. In supersniff the chase camera keeps snapping back to the dog, so the user cannot aim at all.
- Fix: have MapView publish `getScreenCenterLatLng()` = `map.unproject([w/2, h/2])` (adjusted for the container rect) and use it on confirm. Flatten pitch while `lostPinning` and restore it after. In Companion leave `search` for `explore` before opening the flow, or have the chase loop return early on `lostPinning`.

#### UX-1.5 · P1 · Tapping ✕ during a supersniff search offers no way to keep searching
- Sources: a11y-interaction-42
- Where: `components/map/MapView.tsx:4077-4099` (leave/arrived share actions no/yes only), `:4184-4186` (✕ sets leave prompt), `:4145` (nav HUD hidden while prompt)
- Symptom: a brushed ✕ forces "no, nobody" (ends the search) or the dark primary "yes, I did" (files a real sighting).
- Fix: for `prompt.kind === 'leave'`, prepend `{ label: t.search.confirmBack, close: true, onPress: () => setPrompt(null) }`. Leave "arrived" unchanged.

#### UX-1.6 · P1 · Answering "I saw it" when the request failed still says "logged it!"
- Sources: user-paths-27
- Where: `components/map/MapView.tsx:1865-1897`; `i18n/strings.ts:666` (thanksSeen)
- Symptom: offline or on a 5xx, the walker is told "записав! +0 лапок" and offered contacts. The owner never gets the sighting.
- Fix: track `ok` around the await. On `!ok && seen`, show a failure prompt (new `t.search.sendFailed`) with retry and close actions, and `canSeePost: false`.

#### UX-1.7 · P1 · Tapping the active quest waypoint force-completes it from anywhere
- Sources: user-paths-28
- Where: `components/map/MapView.tsx:3798-3817` (onTap not gated on `DEV_TOOLS`, imported at `:18`); `stores/gameStore.ts:836` (forceAdvanceActiveWaypoint); server `routes/quests.ts:226`, `:271` (`force` honoured for any caller)
- Symptom: any user who taps the glowing pin completes that step, or the whole search, without walking there. There is no undo.
- Fix (client): `onTap={DEV_TOOLS && state === 'active' ? … : undefined}`. **DECISION NEEDED (server):** honour `force` only for dev/admin callers. That is a server change, and merging it to `main` deploys to production automatically.

#### UX-1.8 · P1 · Roundtrip walks never count for the daily "plan a route and finish it" task
- Sources: user-paths-43
- Where: `stores/gameStore.ts:1471-1473` (sends the route's last point); `utils/walk.ts:571`, `:593`; `components/map/Companion.tsx:549`; `app/(tabs)/chat.tsx` (walk / walk_to_spot); `components/map/MapView.tsx:4636`; server `dailyTasks.ts:291`, `walkDestinations.ts:160`
- Symptom: every walk from the dog's ring, from chat and from the spot "roundtrip" button ends at the origin. The server rejects it (under 300 m), so the task stays at 0 with no explanation.
- Fix: add `destination?: LatLng` to WalkRouteMeta, set it at each creator, and send `walkRouteMeta?.destination ?? lastPoint` to `api.planWalk`.

#### UX-1.9 · P1 · Tapping your own row on the territory board pins you as a rival
- Sources: consistency-patterns-42, user-paths-30
- Where: `app/(tabs)/tasks.tsx:603-611`, `:886-889`, `:278-325` (onPickOwner), `:265-267`; `components/map/MapView.tsx:3380`, `:562-572`; `components/ui/LeaderboardModal.tsx:109`
- Symptom: a second dog with your own nickname appears, and your ground is repainted in a rival hue. Tapping the pinned "you" row does the correct thing, so the same person gets two behaviours.
- Fix: `onPress={() => (isYou ? onFocusOwnGround(row.mainPiece) : onPickOwner(row))}`, and pass `isYou` from LeaderboardModal's onPick.

#### UX-1.10 · P2 · The Poke button can be spammed, and each tap notifies a real person
- Sources: a11y-interaction-16
- Where: `components/map/PlayerCard.tsx:83-88`, `:167`; server `routes/poke.ts`, `services/presence.ts:327`
- Fix: `if (poked) return;` at the top of poke(), and pass `disabled={poked}` to Primary.

#### UX-1.11 · P2 · Portrait studio: "later" and "another photo" stay live while drawing, and the drawing lands anyway
- Sources: dismissal-state-24, user-paths-38, a11y-interaction-36
- Where: `components/ui/AvatarStudio.tsx:77-91` (draw() always setMe/setDrawn), `:168-182`
- Symptom: after declining, the portrait still appears on the profile. A photo picked mid-draw is replaced by the drawing of the old one.
- Fix: disable Secondary "change" and hide or disable "later" while `busy`. Bump a `reqRef` in pick() and skip setDrawn when it has changed. Keep setMe, because the server has already saved the avatar.

#### UX-1.12 · P3 · Deselecting the pet species does not remove the pet
- Sources: user-paths-36
- Where: `components/ui/AccountEditSheet.tsx:115-121`, `:216-218`, `:226`; `components/ui/AccountDoor.tsx:378-380`; server `routes/auth.ts:379-403`
- Fix: `petName: species ? petName.trim() || undefined : undefined`, and the same for breed, in both files.

#### UX-1.13 · P2 · "Log out" on an anonymous account orphans all progress; "save" says "register first" and offers no way to register
- Sources: user-paths-44
- Where: `components/ui/AccountEditSheet.tsx:353-354`; `services/api.ts:572-583` (rotateDeviceId unconditionally); server `routes/auth.ts:375`, `accountPolicy.ts:50`, `:79`
- Note: this only happens when `REGISTRATION_REQUIRED` is off. The default is on, and the deployed value **was not read** (read-only rule).
- Fix: when `!me.registered`, replace logout and save with a "register to keep progress" link that opens `openDoorSheet('register')`. Add a two-tap confirm to logout. **DECISION NEEDED:** policy for anonymous logout.

#### UX-1.14 · P3 · Radial menu options fire twice on a fast double tap
- Sources: a11y-interaction-26
- Where: `components/map/RadialMenu.tsx:234`; `components/map/Companion.tsx:606-701`
- Fix: add a `firedRef`, reset on `[open, actions]`, and bail out in onClick when it is set.

### Theme 2: Dead ends, stranding and navigation

#### UX-2.1 · P0 · If the map fails to load at start-up, the app has no navigation
- Sources: runtime-1, user-paths-42
- Where: `app/(tabs)/_layout.tsx:81` (tab bar hidden when `appMode==='gate' && map`); `components/map/MapView.tsx:3409-3430` (early return, so the gate ring never mounts); `stores/gameStore.ts:629` (`appMode: 'gate'`); `app/(tabs)/index.tsx:156-163` (logo hidden during gate). Runtime screenshot `shots/map_0_15000.png`.
- Symptom: with a bad connection or blocked tiles, the user sees "мапа не довантажилась" and a retry button, and cannot reach chat, tasks, spots, profile or the report form. With `unsupported` (no WebGL2) there is **not even a retry button**. The `!userPos` locating screen (`MapView.tsx:3401`) has the same trap.
- Fix: in MapView, `useEffect(() => { if (mapProblem && appMode === 'gate') setAppMode('explore') }, [mapProblem])`. Or publish `mapBlocked` to the store and add `&& !mapBlocked` to the hidden rule. Apply the same treatment to the long-locating state.

#### UX-2.2 · P1 · The lost-pet pin step leaves the tab bar live, and the crosshair and card follow onto other tabs
- Sources: z-index-4, dismissal-state-3, user-paths-2, a11y-interaction-4, layout-responsive-16, consistency-patterns-26
- Where: `app/(tabs)/_layout.tsx:81`; `app/(tabs)/index.tsx:47-48`, `:267`; `components/ui/LostFlowModal.tsx:166-175`, `:180`, `:233-315` (body portal at Z.MODAL_GLOBAL, no scrim, card at bottom inset+92 directly above the bar); `stores/gameStore.ts:765-777` (setScreen does not clear lostFlowOpen), `:1364`; `components/map/MapView.tsx:4553-4558` (the onMapScreen pattern it should follow)
- Symptom: tapping chat, tasks or profile while aiming leaves the pin and the "back / confirm" card floating over that screen. Confirm there saves the hidden map's stale centre.
- Fix: `const lostPinning = useGameStore(s => s.lostPinning)` and `hidden = dogCam || lostPinning || (…)`. As a safeguard, gate the pin portal on `currentScreen === 'map'`.

#### UX-2.3 · P1 · Map chrome and markers stay live during the pin step (and under the account door), so aiming is undone or a second sheet opens
- Sources: dismissal-state-11, z-index-10, dismissal-state-12, z-index-18, z-index-21
- Where: `components/map/MapView.tsx:3441-3449` (offscreen chip not suppressed on `lostPinning`), `:3883-3884`, `:4234` (pill row), `:3574` (OtherWalkers), `:3589` (lost pins), `:2530-2535` (petTapHandlers), `:1527` (doorSheetUp); `app/(tabs)/index.tsx:153-163` (logo keyed only on `gateOpen`; its tap calls setAppMode, which clears lostFlowOpen at `gameStore.ts:1364`); `components/ui/LostFlowModal.tsx:245`, `:268`; `components/ui/AccountDoor.tsx:68-75`
- Symptom: while aiming, the off-screen dog chip appears, and tapping it recentres and undoes the aim. The corner logo silently discards the report and flips the mode. Tapping a pet or spot opens LostDogModal or SpotModal under the pin card, and a walker's PlayerCard opens over it. The same marker leak happens under the account door (the z-index-21 part is P3).
- Fix: in the offscreenIndicator IIFE, `if (lostPinning) return null;`. Add `|| lostPinning || doorSheetUp` to the lost-pin and OtherWalker render conditions, and do the same for POIs. Define `logoHidden = gateOpen || lostPinning` in index.tsx. Optionally add `&& !lostPinning` to the pill row.

#### UX-2.4 · P1 · A back gesture out of supersniff leaves another tab with no tab bar
- Sources: dismissal-state-30
- Where: `app/(tabs)/_layout.tsx:81`; `app/(tabs)/tasks.tsx:248-251` (router.push('/') with search intent); `stores/gameStore.ts:765-778`, `:1331`
- Symptom: tasks → tap a pet (supersniff on) → back returns to /tasks with `dogCam` still true. The bar is hidden, and that screen has no logo to turn supersniff off.
- Fix: `const hidden = (dogCam || appMode === 'gate') && currentScreen === 'map';`

#### UX-2.5 · P1 · No Android or Telegram back handling: back closes the whole Mini App, open sheets included
- Sources: a11y-interaction-20, dismissal-state-21, user-paths-49, consistency-patterns-43
- Where: `services/telegram.ts:14-36` (interface has no BackButton), `:164-185` (notifyTelegramReady); `app/(tabs)/tasks.tsx:873-895` and `app/(tabs)/spots.tsx:296` (full-screen sheets not gated on focus; the back gesture changes tab and leaves them painted); no `popstate`/`BackHandler`/`BackButton` anywhere
- Symptom: a half-typed lost-pet report is lost on back. Full-screen boards stay painted over the tab the user navigates back to.
- Fix: add `hooks/useSheetBack(open, onClose)`. In Telegram it uses `BackButton.show/onClick/offClick/hide` with a small stack; on the web it uses pushState/popstate. Use it in LostFlowModal, PostModal, SpotModal, LostDogModal, AboutModal, AccountEditSheet and the three list modals. Call `enableClosingConfirmation` while the report form is dirty. Short term: gate the tasks and spots sheets on `useIsFocused()`.

#### UX-2.6 · P1 · Invite gate is a dead end for existing accounts
- Sources: user-paths-10, layout-responsive-23
- Where: `components/ui/InviteGate.tsx:23-36`, `:33`; `app/_layout.tsx:147-154`; `stores/accessStore.ts:147`; `services/api.ts:395-397`
- Symptom: with INVITE_REQUIRED on, a registered user on a new device is told "your account works as always" and has no login button, no language switch and no way out. This is latent while the flag is off.
- Fix: add a "log in" button that calls `setInviteRequired(false); openDoorSheet('login')`, and add the LangPill.

#### UX-2.7 · P2 · If the door closes mid-session, the app goes dead with no gate and no sheet
- Sources: user-paths-26
- Where: `stores/accessStore.ts:101-110`, `:156`; `app/_layout.tsx:89` (assumeOpen); `components/map/Companion.tsx:155`; `app/(tabs)/profile.tsx:137`
- Symptom: server unreachable at boot, so the door is assumed open. The user picks a mode. A later 403 turns the door to `register`, and every request is then refused with no prompt.
- Fix: in useDoorKeeper, when `me.door === 'register'` and `appMode !== 'gate'`, call `setAppMode('gate')` (navigate to `/`) or `openDoorSheet('register')`.

#### UX-2.8 · P1 · Cold start on /spots or /tasks shows skeletons forever; `lostDogsLoaded` is never set by the live loader
- Sources: user-paths-1, user-paths-12, runtime-2
- Where: `app/(tabs)/tasks.tsx:714-718`, `:435`; `stores/gameStore.ts:1027` (only writer), `:1064-1182` (syncMap never sets it), `:1491`; `app/(tabs)/spots.tsx:96-99`, `:232`; `components/map/MapView.tsx:1140` (only setUserPosition), `:1187`. Runtime: `shots/deep_tasks.png`.
- Symptom: in an area with no pets nearby, the tasks lost-pets card is a skeleton forever, even after the map has loaded. After a reload on /spots or /tasks everything stays grey until the user opens the map.
- Fix: set `lostDogsLoaded: true` in syncMap's success and catch. Move the location → setUserPosition effect to `app/(tabs)/_layout.tsx`, or set `lazy:false` on the map tab. When there is no position, spots shows "locating" with a link to the map.

#### UX-2.9 · P1 · Location denied or timed out is invisible: the "using Kyiv fallback" notice can never render
- Sources: user-paths-5
- Where: `components/map/MapView.tsx:3405`, `:436`, `:388`; `hooks/useLocation.ts:238-291`
- Fix: render a HUD chip (the gpsHeld slot and style) when `location.usingFallback`, with a "turn on location" hint.

#### UX-2.10 · P1 · Chat boot race: empty transcript and endless typing dots
- Sources: dismissal-state-28, user-paths-6
- Where: `app/(tabs)/chat.tsx:171-210` (bootedRef plus deps `[userPosition, lang]`, `:204` finally); `components/map/MapView.tsx:1140`
- Symptom: a GPS fix or language toggle during the first boot cancels the only run. History never loads and "typing…" can stick until reload.
- Fix: deps `[]`, and read position and language from `getState()` inside the effect. Keep `cancelled` for unmount only.

#### UX-2.11 · P1 · Logging out keeps the previous account's chat transcript and paw total
- Sources: dismissal-state-29, dismissal-state-36
- Where: `app/(tabs)/profile.tsx:134-139`; `components/ui/AccountDoor.tsx:422-428`; `app/(tabs)/chat.tsx:172`; `stores/gameStore.ts:880`, `:1153` (Math.max keeps the old total)
- Symptom: on a shared phone, account B sees A's conversation with the dog and A's paw count.
- Fix: **DECISION NEEDED**: (a) `window.location.replace('/')` after logout in both paths (simplest and complete), or (b) a `resetForAccount()` in the stores and a key on ChatScreen by `me.id`.

#### UX-2.12 · P2 · Supersniff with no pets (offline or a quiet area) says "swipe to the next dog" over an empty map
- Sources: runtime-5
- Where: `components/map/MapView.tsx:4008`, `:2214`; `components/map/Companion.tsx:849-850`; `components/ui/CardStack.tsx:268-270`. Runtime: `gate2.png`.
- Fix: when `searchDogs.length === 0`, render a static empty card (offline copy when not connected), and gate the intro hint on dogs existing.

#### UX-2.13 · P2 · The account door has no screen gate and floats over the chat or profile tabs
- Sources: z-index-12
- Where: `components/ui/AccountDoor.tsx:286-289`, `:68-75`; `stores/accessStore.ts:103-111`; `app/_layout.tsx:73-96`; `app/(tabs)/_layout.tsx:81`
- Fix: render the sheet only when `currentScreen === 'map'`, and when it becomes non-null off the map, navigate to `/`.

#### UX-2.14 · P3 · An unknown URL shows expo-router's English "Unmatched Route"
- Sources: user-paths-40
- Where: `app/_layout.tsx:169`; `vercel.json` rewrites
- Fix: add `app/+not-found.tsx` returning `<Redirect href="/" />`.

#### UX-2.15 · P2 · Walks have no arrival: the only way to end one is a button labelled "cancel walk"
- Sources: user-paths-48
- Where: `components/map/MapView.tsx:4283`; `i18n/strings.ts:647`, `:1231`; server `dailyTasks.ts` (noteWalkArrival)
- Fix: **DECISION NEEDED**: (a) detect arrival within 60 m of the destination (needs UX-1.8's meta), show a bubble, clear the route and refresh tasks; or (b) an interim relabel to "finish walk".

#### UX-2.16 · P2 · A deep-linked pet outside 5 km vanishes once a search on it starts
- Sources: user-paths-45
- Where: `components/map/MapView.tsx:4598`, `:675`; `stores/gameStore.ts:1018-1021`, `:1127-1134`
- Fix: in both syncs, keep every id in `[selectedDogId, searchTarget?.dogId, postDog?.id]`.

#### UX-2.17 · P2 · Visit ring: an empty category shows only the re-roll disc and stays empty after spots arrive
- Sources: user-paths-46
- Where: `components/map/Companion.tsx:754-756`, `:661`
- Fix: add `spots.length` to the cache key. When a category is empty, show a line saying so and stay on the category level.

#### UX-2.18 · P2 · The register button stays greyed out with no reason given
- Sources: user-paths-23, a11y-interaction-25
- Where: `components/ui/AccountDoor.tsx:431`, `:600`, `:251-260`; `i18n/strings.ts:551`, `:1135`
- Fix: disable only on `busy`. In register(), set a specific error for the first unmet rule (nickname, email, password, consent).

#### UX-2.19 · P3 · The "your link has expired" notice is dropped on the register screen
- Sources: user-paths-37
- Where: `components/ui/AccountDoor.tsx:304`, `:330`, `~599`
- Fix: render `{info ? <div style={NOTE}>{info}</div> : null}` in the register block too.

### Theme 3: Chat flows

#### UX-3.1 · P1 · The send spinner is white on a white button
- Sources: spacing-borders-1, user-paths-16, layout-responsive-5, consistency-patterns-2, a11y-interaction-6, runtime-7
- Where: `app/(tabs)/chat.tsx:412-413`, `:634-641` (`SURFACE.fill` = #fff, `constants/surface.ts:24`)
- Fix: `<ActivityIndicator size="small" color={INK} />`. Optionally grey the arrow when the draft is empty.

#### UX-3.2 · P2 · The chat start_quest action says "starting search" and navigates even when it failed
- Sources: user-paths-15, dismissal-state-22
- Where: `app/(tabs)/chat.tsx:76-78`; `stores/gameStore.ts:793-804`
- Fix: check `{ quest }`. If it is null, return a new `t.chat.couldntStartSearch` (or "needs location") and do not navigate.

#### UX-3.3 · P2 · highlight_spot claims to show a spot the map cannot find
- Sources: user-paths-47
- Where: `app/(tabs)/chat.tsx:80-83`; server `actionParser.ts:56-59`; `components/map/MapView.tsx:~2608`, `~2410`
- Fix: look the spot up first. If it is missing, return `t.chat.lostTrackOfSpot` and do not navigate.

#### UX-3.4 · P2 · A chat action that lands after the user leaves the chat still pulls them to the map
- Sources: dismissal-state-20
- Where: `app/(tabs)/chat.tsx:72-134`, `:253`, `:78`, `:82`, `:109`, `:134`
- Fix: `if (currentScreen === 'chat') router.push('/')`.

#### UX-3.5 · P2 · After a cold start on a non-map tab, a walk from chat is wiped when the user answers the gate
- Sources: user-paths-31
- Where: `app/(tabs)/chat.tsx:100-110`; `stores/gameStore.ts:629`, `:1361-1370`; `components/map/Companion.tsx:631`
- Fix: before setWalkRoute or setSelectedSpot, if `appMode === 'gate'` and the door is open, `setAppMode('explore')`. Apply the same in the spots and tasks handlers.

#### UX-3.6 · P2 · Every chat failure says "can't reach the walk route", and the typed text is lost
- Sources: user-paths-33
- Where: `app/(tabs)/chat.tsx:216-283`, `:219`, `:278`; `i18n/strings.ts:925`
- Fix: add a new `t.chat.cantReachDog`, restore the draft, and remove the optimistic bubble, but only when `sendChat` itself failed. Wrap dispatchAction in its own try.

#### UX-3.7 · P2 · The composer input has no visible edge on the white page
- Sources: spacing-borders-14
- Where: `app/(tabs)/chat.tsx:385-397`, `:609-632`; stale comment at `components/ui/LostFlowModal.tsx:74`
- Fix: give it a white fill, `R.button` radius and `HandDrawnFrame` (the Field recipe), and set placeholder to `colors.greyLight`.

### Theme 4: Language: English inside the Ukrainian-default UI

#### UX-4.1 · P1 · Sighting-report and walk-here results are English dog bubbles
- Sources: user-paths-8, consistency-patterns-4 (MapView part), typography-33
- Where: `components/map/MapView.tsx:4583-4591`, `:4621-4632`; `stores/gameStore.ts:1480-1485`; `i18n/strings.ts:917`, `:1481` (walkingTo exists)
- Fix: add `t.bubbles.sightingMoved(name)`, `sightingLogged`, `sightingNoLocation`, `sightingFailed`, `walkNoLocation` and `roundtripTo(name)` to both locales. Return `{ok:false, reason:'no-location'}` when there is no position.

#### UX-4.2 · P1 · The dog ring's walk, meet and visit lines are English
- Sources: user-paths-9, consistency-patterns-4 (Companion part)
- Where: `components/map/Companion.tsx:458`, `:467`, `:516`, `:525-529`, `:537-541`, `:563-575`, `:585`, `:593`, `:598`
- Fix: move the lines to `t.bubbles`/`t.modes` in both locales, using the uk plural helper for "stops".

#### UX-4.3 · P2 · Search lead and nudge barks mix Ukrainian and English at random
- Sources: user-paths-20, consistency-patterns-4 (bark pools)
- Where: `components/map/MapView.tsx:1809-1815`, `:2006-2045`
- Fix: add per-locale arrays `t.bubbles.searchLead(name)`, `searchNudge`, `searchNudgeNamed(name)`, read through a stringsRef inside the interval.

#### UX-4.4 · P1 · The lost-pet cluster label "N lost pets" is hardcoded English, and the cluster has no accessible name
- Sources: typography-3, spacing-borders-46 (label half), a11y-interaction-44
- Where: `components/map/LostDogCluster.tsx:137-138`, `:81-83`, `:151-179`; `i18n/strings.ts:~508` (plural helper), `:813`, `:1393`
- Fix: `t.map.lostPetsCount(n)` in both locales. Add `aria-label` and `aria-expanded` on the centre, and `tabIndex={expanded?0:-1}` and `aria-hidden={!expanded}` on the ring buttons.

#### UX-4.5 · P1 · The chat typing indicator says "sniffing…" in English
- Sources: typography-4, consistency-patterns-27, user-paths-21 (chat part)
- Where: `app/(tabs)/chat.tsx:462-472`; `i18n/strings.ts:778`, `:1362`; pattern at `components/map/SniffPress.tsx:616`
- Fix: `useStrings()` in TypingIndicator and render `t.sniff.sniffing` with its trailing ellipsis stripped, followed by `{dots}`.

#### UX-4.6 · P1 · Quest history shows "5m ago · +25pts" next to rows that read "+25 🐾"
- Sources: typography-5, consistency-patterns-28, user-paths-21 (tasks part)
- Where: `app/(tabs)/tasks.tsx:48-56` (relativeWhen), `:762`, `:819`, `:857`; `i18n/strings.ts:790` (`t.time.ago`), `:810` (`t.tasks.reward`)
- Fix: relativeWhen returns `{value, unit}` and renders `t.time.ago`. Use `t.tasks.reward(q.rewardPoints)`, after confirming that quest points are the same unit as paws; if not, add `t.tasks.questPoints`.

#### UX-4.7 · P2 · Distances show Latin "m"/"km", and the formatter is copied four times
- Sources: user-paths-32, consistency-patterns-15
- Where: `app/(tabs)/profile.tsx:68-71`; `components/ui/LostDogModal.tsx:20-23`; `components/ui/SpotCardStack.tsx:58-61`; `utils/geo.ts:23-26` (used by LoreFavouriteCard.tsx:48, LostDogCardStack.tsx:151); `i18n/strings.ts:887` ("кв. км")
- Fix: add `t.units.m/km`. Keep one `formatDistance(m, units, {snap})` in utils/geo and delete the copies.

#### UX-4.8 · P2 · Accessibility labels are hardcoded in English
- Sources: a11y-interaction-11, user-paths-39, typography-45, consistency-patterns-40, runtime-8 (also the aria halves of spacing-borders-6, consistency-patterns-9, consistency-patterns-32, a11y-interaction-49)
- Where: `app/(tabs)/index.tsx:172-178` (logo); `components/ui/LeaderboardModal.tsx:158`, `LostDogsModal.tsx:101`, `SpotsCategoryModal.tsx:116` (`aria-label="Close"`); `components/ui/StatusBar.tsx:177`; `components/map/RadialMenu.tsx:51-92`; `app/(tabs)/chat.tsx:410` (send has no label); `components/map/MapView.tsx:4508` (restack); `components/map/PoiMarker.tsx:53-55`
- Fix: use `t.modals.common.close` (already exists) in the three modals. Add `t.hud.logoExplore/Play/Back`, `t.hud.meterA11y`, `t.chat.send` and `t.hud.restack`, and localize the RadialMenu labels.

#### UX-4.9 · P2 · The lost-pet sheet promises "bonus points"; everywhere else the reward is paws
- Sources: typography-25
- Where: `i18n/strings.ts:938-939`, `:1497`; rendered at `components/ui/LostDogModal.tsx:307`
- Fix: `questCta: (p) => \`виконай квест пошуку — отримай +${p} 🐾\`` (and the en equivalent).

#### UX-4.10 · P3 · "ТЕРМІНОВО" is the only all-caps string in a lowercase UI
- Sources: typography-24
- Where: `i18n/strings.ts:935`, `:1494`; `components/ui/LostDogModal.tsx:206`, `:296`; unused `tasks.badgeUrgent/badgeSearching` at `strings.ts:242-243`, `:816-817`, `:1396-1397`
- Fix: lowercase it, and delete the unused tasks keys.

### Theme 5: Loading, empty and error states

#### UX-5.1 · P2 · Profile and chat show raw exception text; profile territory stats shimmer forever on failure
- Sources: user-paths-7, consistency-patterns-5, consistency-patterns-29, a11y-interaction-47, runtime-6
- Where: `app/(tabs)/profile.tsx:181-187`, `:189-197` (comment promises dashes), `:97-106` (StatRow shimmer on undefined), `:303-325`, `:459`; `app/(tabs)/chat.tsx:202`, `:328`. Runtime: `375x812_chat.png`, `375x812_profile.png`, `320x640_profile.png`.
- Fix: `console.warn` the error and show a translated line (`t.connection.offline` or a new `t.profile.loadFailed`), or skip it when the connection banner already covers the case. Add `boardFailed` so the rows show "—". In chat, show `t.chat.cantReachWalk()` as an assistant bubble plus a retry that resets `bootedRef`.

#### UX-5.2 · P2 · Profile HUD meters show 0 until the profile loads, which reads as a starving dog
- Sources: consistency-patterns-7
- Where: `app/(tabs)/profile.tsx:398`, `:405`, `:412`
- Fix: fall back to the store values (`happiness`, `hunger`, `tokensCollected`).

#### UX-5.3 · P2 · Spots and favourites: a failed load reads as "nothing nearby" or "nothing saved", favourites has no skeleton, and tasks cards pop in
- Sources: user-paths-13, user-paths-35, consistency-patterns-19, user-paths-53
- Where: `stores/gameStore.ts:1236-1243`, `:1256-1263`; `app/(tabs)/spots.tsx:65-71`, `:96-99`, `:233`, `:240-252`, `:259`, `:268`; `app/(tabs)/tasks.tsx:~565`, `~642`
- Note: hiding the lost-pets card when a fetch settles empty is deliberate. The verifier refuted that part of consistency-patterns-19.
- Fix: add `spotsError` and `loreFavouritesError` flags and render "couldn't load, tap to retry". Show `SpotCardStackSkeleton` while favourites load. Give the board and happy cards a title plus skeleton rows instead of `null`.

#### UX-5.4 · P2 · The daily tasks card shows "0 / 0" with no rows when the fetch fails
- Sources: user-paths-17
- Where: `app/(tabs)/tasks.tsx:427`, `:789-790`; `stores/gameStore.ts:106-107`, `:652`, `:1499-1506`
- Fix: add `dailyTasksStatus`. Show skeleton rows while loading, and a tappable "load failed" line on error. Hide the tally when there are no rows.

#### UX-5.5 · P2 · Pet ad reader: a failed load says "try again" but has no retry; the "contacts after sighting" hint has no sighting button
- Sources: user-paths-14, a11y-interaction-33, dismissal-state-31
- Where: `components/ui/PostModal.tsx:90-108`, `:209-211`, `:268`, `:277-300`; `components/map/MapView.tsx:4570-4576`, `:4116`; `i18n/strings.ts:955`, `:1510`
- Fix: add an `attempt` state in the effect deps and a retry button (MODAL_PILL_DARK). Add an optional `onReportSighting` prop, shown when `contactsHidden`.

#### UX-5.6 · P2 · PlayerCard says "no territory" when the load failed, and "poked!" when the poke failed
- Sources: user-paths-34, consistency-patterns-44
- Where: `components/map/PlayerCard.tsx:83-88`, `:137`, `:140-155`; `stores/gameStore.ts:~1185`
- Fix: hide the territory row, or show "unknown", when the load failed. Make `pokePlayer` return a boolean, and only show "poked" on success.

#### UX-5.7 · P2 · A failed long-press sniff ends silently; the "nothing here" card is Ukrainian-only
- Sources: user-paths-19, a11y-interaction-32
- Where: `components/map/SniffPress.tsx:305-345`, `:328-333`, `:342-344`, `:536-553`
- Fix: add `t.sniff.nothingTitle/nothingStory/failedTitle/failedStory` in both locales, and show the failed card in the catch.

#### UX-5.8 · P2 · "Walk here" / "roundtrip" from a spot: no busy state, silent failure, and a late result closes the next spot's card
- Sources: dismissal-state-6, user-paths-4, a11y-interaction-8, dismissal-state-32
- Where: `components/map/MapView.tsx:4619-4643`; `components/ui/SpotModal.tsx:270-290`; `services/directions.ts:72-114`
- Fix: use `fetchWalkingRouteOrLine` (always returns a route, as SniffPress does). Add a `walkHerePendingRef` or `busy` state with the disabled style. After the await, check that `selectedSpotId` and `overlayEpoch` are unchanged before applying.

#### UX-5.9 · P3 · Hearting a place silently undoes itself when the request fails
- Sources: user-paths-54
- Where: `stores/gameStore.ts:1269-1298`; `components/map/LoreMore.tsx:448-452`
- Fix: return a boolean from the toggle, and show a short inline "couldn't save" message on false.

#### UX-5.10 · P3 · A failed Wikipedia "read more" can never be retried, and it hides the article link
- Sources: dismissal-state-27
- Where: `components/map/LoreMore.tsx:166`, `:304`, `:324`, `:366`
- Fix: reset `failed` when the block closes, and render the Wikipedia link whenever `hasWiki`.

#### UX-5.11 · P2 · Keyframes the sheets depend on are not global: two sheets don't slide, and the profile skeleton doesn't shimmer
- Sources: user-paths-22, consistency-patterns-6, consistency-patterns-8
- Where: `components/ui/LostFlowModal.tsx:346`; `components/ui/PostModal.tsx:112`, `:161`; `components/ui/SpotModal.tsx:294-302`; `components/ui/AboutModal.tsx:280-288`; `app/(tabs)/profile.tsx:74`, `:90` (`lost-dog-shimmer` is never defined); `components/ui/CardStack.tsx:610-618`; `public/index.html:~199`
- Fix: move `top-sheet-in/out` and a single shimmer keyframe into `public/index.html` beside pop-in, remove the in-component copies, and point profile at the shared shimmer.

#### UX-5.12 · P3 · The report form cannot remove an attached photo, and re-picking the same file after an error does nothing
- Sources: dismissal-state-14, user-paths-41
- Where: `components/ui/LostFlowModal.tsx:439`, `:451-457`, `:197-198`; pattern at `components/ui/AvatarStudio.tsx:146-151`
- Fix: clear `e.target.value` in onChange, and add a "remove photo" link.

### Theme 6: Stale async and state leaking across mode and tab switches

#### UX-6.1 · P1 · The poke toast replays, with a haptic buzz, every time the user returns to the map
- Sources: dismissal-state-5
- Where: `components/map/MapView.tsx:3912`; `components/map/PokeToast.tsx:33-37`; `stores/gameStore.ts:1144-1151`; `constants/experiments.ts:18`
- Fix: keep the last-seen seq at module scope, or always mount the toast and return null off the map.

#### UX-6.2 · P2 · A search answer that resolves after a mode flip leaves an unanswerable question on the dog
- Sources: dismissal-state-7
- Where: `components/map/MapView.tsx:645-654`, `:1890`, `:523-532`, `:3878`, `:4042`; `components/map/Companion.tsx:960-975`
- Fix: capture `overlayEpoch` before the await and skip setPrompt if it changed. Gate `question` on `DOG_CAM && dogCam`.

#### UX-6.3 · P2 · A walk requested from the ring lands after a mode flip, including in supersniff where it cannot be cancelled
- Sources: dismissal-state-8
- Where: `components/map/Companion.tsx:530-560`; `components/map/MapView.tsx:3827`, `:3835`, `:4234`; `stores/gameStore.ts:~1366-1369`
- Fix: add an epoch check in `.then`. Optionally hide the walk route and WalkStops in dogCam.

#### UX-6.4 · P2 · A sniff discovery that resolves after a flip or tab switch pops up in the new context
- Sources: dismissal-state-9
- Where: `components/map/SniffPress.tsx:169-191`, `:295-345`, `:362`
- Fix: record the epoch in startHold, and return in finishHold if it changed.

#### UX-6.5 · P2 · A late Directions response redraws the route of a search that was already left
- Sources: dismissal-state-10
- Where: `components/map/MapView.tsx:1786-1788`, `:3900`, `:4088-4091`
- Fix: apply the route only if `searchTarget` still matches this dog and spot.

#### UX-6.6 · P2 · PlayerCard "show ground" closes the card, then it reopens over the flight
- Sources: dismissal-state-13
- Where: `components/map/PlayerCard.tsx:96-101`; `components/map/MapView.tsx:2747-2767`, `:2814-2825`
- Fix: add an `openCard?: boolean` on the focusedTerritory command, set only from the tasks tab.

#### UX-6.7 · P2 · Closing a walker's card before its data arrives still pins their district and flies the camera there
- Sources: dismissal-state-23
- Where: `components/map/MapView.tsx:2719`, `:2750-2767`, `:3907`, `:647-654`
- Fix: bump `openSeqRef` in onClose and on `overlayEpoch` (move the ref above the effect).

#### UX-6.8 · P2 · The supersniff prompt answers stay live while the ring is open, though the pet card has slid away
- Sources: dismissal-state-25
- Where: `components/map/MapView.tsx:715`, `~4042`, `~652`, `~659`; `components/map/Companion.tsx:425-433`
- Fix: add `&& !menuOpen` to the prompt HUD condition.

#### UX-6.9 · P2 · The post reader and PlayerCard come back after leaving the map, covering a spot picked on another tab
- Sources: z-index-28
- Where: `components/map/MapView.tsx:409`, `:479`, `:647-654`, `:3906`, `:4556`, `:4611`; `stores/gameStore.ts:765-777`
- Fix: in the overlayEpoch effect, `setPostDog(null); setCardPlayer(null);`.

#### UX-6.10 · P3 · A spiderified cluster survives mode flips and tab switches
- Sources: dismissal-state-17
- Where: `components/map/MapView.tsx:427`, `:647-654`, `:2570`, `:3262`
- Fix: add `setExpandedClusterKey(null)` in the overlayEpoch effect.

#### UX-6.11 · P3 · A mode flip mid-sniff-hold leaves one-finger panning disabled for one drag
- Sources: dismissal-state-26
- Where: `components/map/SniffPress.tsx:171-185`, `:289`, `:431`
- Fix: in the epoch reset, clear `startPxRef` and call `map.dragPan.enable()`.

#### UX-6.12 · P3 · "Let's go here" on a sniffed place installs its walk after dismissal and wipes the newer discovery
- Sources: dismissal-state-33
- Where: `components/map/SniffPress.tsx:460-496`
- Fix: capture the epoch and the discovered id (via a ref), and bail out after the await if either changed.

#### UX-6.13 · P3 · Tapping a row on the standing mid-walk throws the walk away
- Sources: dismissal-state-34
- Where: `app/(tabs)/tasks.tsx:271`, `:289-293`; `stores/gameStore.ts:1360-1370`
- Note: this follows a documented rule in setAppMode.
- Fix: **DECISION NEEDED**: when a walk is live, only set `territoryVisible` instead of switching mode.

#### UX-6.14 · P3 · The spots "see all" feed and carousels reorder on every GPS fix
- Sources: dismissal-state-35
- Where: `app/(tabs)/spots.tsx:107-124`, `:296-297`; pattern at `app/(tabs)/tasks.tsx:207-222`
- Fix: bucket the position to about 110 m before sorting, as tasks does.

#### UX-6.15 · P2 · Any press on the bare map wipes the sniffed landmark, and that place is never offered again
- Sources: a11y-interaction-23
- Where: `components/map/SniffPress.tsx:310`, `:377`, `:389`, `:434-435`
- Fix: clear `discovered` only when a new hold commits, or on a short tap with no movement, never on a drag or pinch.

### Theme 7: Overlays, HUD and z-order

#### UX-7.1 · P1 · The "abandon quest" overlay pill sits under the QuestPill, and neither control asks first
- Sources: z-index-2, layout-responsive-4, a11y-interaction-5, consistency-patterns-25, user-paths-18
- Where: `components/map/MapView.tsx:4233-4300` (row at `insets.top+100`, `:4245`, `:4281-4291`, `:4288-4297`); `components/ui/QuestPill.tsx:26`, `:49-58`; `app/(tabs)/index.tsx:20`, `:244-261`, `:300-311` (quest row at inset+91..133); leave-search confirm pattern at `MapView.tsx:4184-4186`; `stores/gameStore.ts:857-868`
- Symptom: two centred pills overlap. The cancel-walk and GPS pills are hidden too when a quest and a walk are both live. One stray tap abandons a lost-pet search.
- Fix: drop the overlay abandon pill (QuestPill has its own ×). Offset the column below the quest row when `activeQuest` is set (+52 px, or measure it). Add a two-tap arm/confirm to QuestPill's ×. The DogPrompt "leave" flow is tied to `searchTarget`, so it is not a drop-in.

#### UX-7.2 · P1 · The off-screen companion chip sits on the tab bar and the top HUD and takes their taps
- Sources: z-index-3, layout-responsive-3, a11y-interaction-24
- Where: `components/map/MapView.tsx:3441-3495`, `:3466-3468` (0.02 / 0.08 reserves), `:4337-4353` (fixed body portal, z 38); `app/(tabs)/_layout.tsx:178-182` (bar at bottom+24, height 58)
- Symptom: a tab under the chip recentres the map instead of navigating. At the top edge the chip covers the logo or status pills.
- Fix: compute px reserves: bottom = `insets.bottom + pwaOvershoot + S.xxl + 58 + S.s` (`TAB_BAR_STRIP`), top = the bottom of the HUD row + `S.s`. Apply the same band to the side chips.

#### UX-7.3 · P1 · Poke toast: English, a raw z-index of 9000 over every modal, off-system dark styling, and it covers the exit pills
- Sources: typography-21, consistency-patterns-3, spacing-borders-17, z-index-6, dismissal-state-15, layout-responsive-21, user-paths-50, a11y-interaction-37, z-index-29
- Where: `components/map/PokeToast.tsx:55-97` (`:60` zIndex 9000, `:57` top +96, `:79-89` strings and font sizes 15/12); `components/map/MapView.tsx:3912`, `:4245`; `constants/z.ts:75-81`; existing `poked` key in `i18n/strings.ts`
- Symptom: a poke paints over open sheets, and tapping it pans the hidden map. For 5.2 s it covers "cancel walk / abandon quest". Ukrainian users read "X poked you!". A long name truncates the verb away.
- Fix: add `Z.TOAST` between HUD_PILLS_OVERLAY (54) and MODAL_MAP (60), for example 56. Add `t.poke.*` strings. Split name and verb into two spans. Use TYPE sizes, VOICE or SURFACE styling, and `role="status" aria-live="polite"`. Offset below the pill row when a walk, quest or GPS pill is live.

#### UX-7.4 · P2 · Every MapView layer is trapped under the HUD View, so z.ts's marker tiers have no effect against the HUD
- Sources: z-index-1
- Where: `app/(tabs)/index.tsx:274` (mapLayer, no zIndex), `:285` (HUD z 30), `:136-145` (the file admits the trap); `constants/z.ts:4-9`, `:36-44`, `:72`; `node_modules/react-native-web/dist/exports/View/index.js:131-133`
- Fix: make mapLayer `zIndex: 'auto'` or a plain `<div>`, and update the z.ts header. **Risk: global.** Afterwards the companion (42), lost-pet chips (35) and sniff bubble (45) paint over the logo and pills. z.ts intends that, but it needs a visual pass.

#### UX-7.5 · P2 · ConnectionBanner: overlaps the HUD, uses a raw z of 50, off-palette colours, and says "map" on every tab
- Sources: z-index-8, layout-responsive-24, consistency-patterns-33, runtime-3, user-paths-25 (banner part), runtime-9
- Where: `components/ui/ConnectionBanner.tsx:36-37`, `:59-69`; `app/_layout.tsx:175-176`; `i18n/strings.ts:929`, `:1488`; also raw `'#a33'` at `profile.tsx:629` and `chat.tsx:599`, placeholder `'#999'` at `chat.tsx:391`, `'#f0f0f0'` at `StatusBar.tsx:353`. Runtime: `gate1.png`, `h320_walk.png`, `375x812_spots.png`, `375x812_profile.png`.
- Note: the claimed z tie with walk stops is refuted, because the banner sits in a different stacking context. The banner staying below modals is intended.
- Fix: add a `Z.BANNER` token. Use INK background, white text and TYPE.small. Use a screen-neutral string. **DECISION NEEDED (placement):** (a) anchor above the tab bar (`bottom: insets.bottom + TAB_BAR + S.s`), or (b) below the HUD row (`top: insets.top + S.xxl + 59 + S.s`). Note that (b) collides with the QuestPill row.

#### UX-7.6 · P3 · AboutModal uses a raw zIndex of 1000, outside the tier system
- Sources: z-index-7, layout-responsive-27, consistency-patterns-53, a11y-interaction-54, user-paths-25 (About part)
- Where: `components/ui/AboutModal.tsx:113`
- Fix: add `Z.MODAL_INFO = 90` (above the account edit sheet, below the splash) and use it. Plain MODAL_GLOBAL would make its order against the edit sheet depend on DOM order.

#### UX-7.7 · P3 · The splash is trapped in #root and sits under body portals
- Sources: z-index-5
- Where: `components/ui/Splash.tsx:50` (not `:121`, as the finding said); `app/_layout.tsx:48-51`, `:186`; `components/ui/AccountDoor.tsx:68-75`, `:483`
- Symptom: a cold `?reset=` link shows the account paper over the splash for about 1 s.
- Fix: portal the splash to `document.body` at `Z.SPLASH`.

#### UX-7.8 · P2 · Transparent scrims (pet card, spot card) swallow the first tab tap and freeze map drag
- Sources: z-index-11, a11y-interaction-21
- Where: `components/ui/LostDogModal.tsx:215-226`; `components/ui/SpotModal.tsx:67-80`; `stores/gameStore.ts:768-775`
- Fix: stop the scrim above the tab bar (a new `TAB_BAR_CLEARANCE` constant) so tab taps reach the bar, which already clears the selection. Close on `onPointerDown` so a drag starts closing the card.

#### UX-7.9 · P3 · Full-screen list modals keep catching taps during the fade-out
- Sources: z-index-26, a11y-interaction-40
- Where: `components/ui/LostDogsModal.tsx:58-65`; `components/ui/LeaderboardModal.tsx:81-88`; `components/ui/SpotsCategoryModal.tsx:60-69`, `:98`
- Fix: `pointerEvents: closing ? 'none' : 'auto'` on each root. Optionally add a pickedRef.

#### UX-7.10 · P2 · Account edit sheet: no tap-out layer, so the profile stays live behind it, and "done" silently drops unsaved edits
- Sources: z-index-24, a11y-interaction-51, consistency-patterns-50
- Where: `components/ui/AccountEditSheet.tsx:114-135`, `:155-163`, `:175`, `:350`; `components/ui/AccountDoor.tsx:68-75`; pattern at `components/map/PlayerCard.tsx:116-118`
- Fix: add a shield layer (pointerEvents auto), with `onClick` closing only when not dirty. On "done" while dirty, save or warn. Add a hint that the presence toggle applies immediately.

#### UX-7.11 · P3 · The mirrored off-screen bubble is not portaled with its chip, so the two drift apart in the PWA and on desktop
- Sources: z-index-9
- Where: `components/map/MapView.tsx:4396-4431`; `public/index.html:162-167`
- Fix: render the bubble inside the chip's fixed portal wrapper, positioned relative to the chip.

#### UX-7.12 · P3 · The right-edge off-screen chip covers the "restack all" pill
- Sources: z-index-30
- Where: `components/map/MapView.tsx:4314`, `:4506-4530`
- Fix: move the restack pill to `top: calc(50% + 72px)` when the chip is on the right edge.

### Theme 8: Map interaction and marker stacking

#### UX-8.1 · P1 · A tap on any marker also reaches MapLibre's map click: the cluster can't collapse from its badge, and ring drill-downs close the menu
- Sources: a11y-interaction-1
- Where: `components/map/MapView.tsx:3249-3263` (map click clears cluster and menu), `:410-415` (comment admits this), `:2561`; `node_modules/maplibre-gl/src/ui/handler_manager.ts:184`, `:228`; `map_event.ts:43-46`; `components/map/LostDogCluster.tsx:84`; `components/map/RadialMenu.tsx:233`; `components/map/Companion.tsx:367-371`, `:655-693`, `:1026`
- Note: confirmed **from code only**. Test on a phone. If the drill-downs do close on a device, raise this to P0.
- Fix: in the map click handler, return early if `e.originalEvent.target.closest('.maplibregl-marker')`, then remove the `SUPPRESS_MAP_CLICK_MS` hack. **DECISION NEEDED:** whether tapping a different marker should still close an open menu or cluster. If yes, do that explicitly in the marker's onTap.

#### UX-8.2 · P2 · Other walkers use the HUD tier (33) and paint over lost-pet pins
- Sources: z-index-13
- Where: `components/map/OtherWalker.tsx:168`, `:261`; `components/map/LostDogMarker.tsx:125`; `components/map/MapLibreMarker.tsx:104`
- Fix: walkers go to `Z.MARKER_DEFAULT`, and add `MARKER_LOST_PET` above it for every lost pin (unselected pins are currently `auto`, so a tier at 8 alone does nothing). Ship with UX-8.3.

#### UX-8.3 · P2 · The expanded cluster ring paints under neighbouring markers, because the tier never reaches the marker element
- Sources: z-index-19
- Where: `components/map/LostDogCluster.tsx:70`, `:106`, `:177`; `constants/z.ts:30-32`
- Fix: `zIndex={expanded ? Z.MARKER_CLUSTER_CHILD : undefined}` on the MapLibreMarker.

#### UX-8.4 · P2 · The sniff discovery card paints over the dog's radial menu
- Sources: z-index-20
- Where: `components/map/SniffPress.tsx:504`, `:632`, `:146`, `:176`, `:377`, `:493`; pattern at `components/map/WalkStops.tsx:90-113`, `:161-166`
- Fix: yield to the menu with `zIndex={menuOpen ? Z.MARKER_DEFAULT : Z.HUD_SNIFF_BUBBLE}`. **Ship together with UX-8.5.**

#### UX-8.5 · P3 · HUD_SNIFF_BUBBLE (45) is labelled "top of HUD tier" but sits under the walk stops (46/50)
- Sources: z-index-14
- Where: `constants/z.ts:76`; `components/map/SniffPress.tsx:504`, `:632`
- Fix: set it to 52. Doing this without UX-8.4 makes the menu overlap worse.

#### UX-8.6 · P3 · The selected spot's pin is not lifted in z
- Sources: z-index-31
- Where: `components/map/PoiMarker.tsx:51`; `components/map/MapView.tsx:3708-3714`
- Fix: `zIndex={selected ? Z.MARKER_COMPANION + 1 : undefined}`, or add a `Z.MARKER_SELECTED` shared with LostDogMarker.

#### UX-8.7 · P3 · The lost-pet close-up still shows walk stops and the sniff card over the selected pet
- Sources: z-index-27
- Where: `components/map/MapView.tsx:3835`, `:3842`, `:3859`; `components/map/WalkStops.tsx:161`; `components/map/SniffPress.tsx:504`; `stores/gameStore.ts:1193-1195`
- Fix: gate `<WalkStops/>` on `!selectedDogId`. In SniffPress, clear `discovered` when a dog is selected (do not unmount it).

#### UX-8.8 · P1 · Walker name tags are white 10px text on pale owner colours (about 1.2:1 contrast)
- Sources: spacing-borders-29, typography-34, typography-29
- Where: `components/map/OtherWalker.tsx:303-306`; `utils/territoryColor.ts:49-52`, `:124-141`
- Fix: add `ownerTextColor(id)` (INK on light tones and the yellow/lime hues, white otherwise), use font size `TYPE.caption` (11), and set maxWidth to about 104.

#### UX-8.9 · P2 · Map name labels are nowrap with no width cap
- Sources: typography-14
- Where: `components/map/LostDogMarker.tsx:250-258`; `components/map/PoiMarker.tsx:96-104`; pattern at `RadialMenu.tsx:366-372`
- Fix: add `maxWidth: 150, overflow: hidden, textOverflow: ellipsis`.

#### UX-8.10 · P2 · The expanded cluster ring shows 40px emoji-only discs instead of the 54px photo pins
- Sources: spacing-borders-46 (size half)
- Where: `components/map/LostDogCluster.tsx:37`, `:161-181`; `components/map/LostDogMarker.tsx:64`
- Fix: reuse the photo-over-emoji layering at 54px, and check RING_RADIUS (75, maybe 85).

#### UX-8.11 · P2 · Quest waypoint markers: 1px hairline, off-token blue, 28px tap target
- Sources: spacing-borders-15
- Where: `components/map/WaypointMarker.tsx:33-55`; `constants/surface.ts:5-6`; `components/map/MapView.tsx:3795-3800`
- Fix: use SURFACE.hair, `colors.blue` for active, greyPale/grey for reached, and a 44px hit wrapper (the STOP_DOT_HIT_PAD pattern).

#### UX-8.12 · P3 · Paw and bone pickups are 22-24px targets
- Sources: spacing-borders-45
- Where: `components/map/FoodMarker.tsx:31`; `components/map/TokenMarker.tsx:35`; `components/map/MapView.tsx:2541`, `:2547`, `:2151` (auto-collect)
- Fix: transparent padding of 12 plus an offset, as `WalkStops.tsx:49`, `:170` does.

#### UX-8.13 · P3 · The POI disc is 44px but draws the 47px marker icon
- Sources: spacing-borders-47
- Where: `components/map/PoiMarker.tsx:68`; `constants/sizing.ts` (ICON_HERO.marker); `components/map/PoiCluster.tsx:46`
- Fix: size the disc to `ICON_HERO.marker`.

#### UX-8.14 · P3 · The SOS pulse ring uses a 1.5px border, which Chrome floors to 1px
- Sources: spacing-borders-36
- Where: `components/map/LostDogMarker.tsx:156`, `:170` (the stems at `:240` and `PoiMarker.tsx:94` are divs, not borders, so they are only off-token)
- Fix: `2px solid`, and make the stems `colors.greyLight`.

#### UX-8.15 · P2 · The map-failed "retry" button is a thin 1.5px pill with a regular-weight label
- Sources: spacing-borders-16, typography-41
- Where: `components/map/MapView.tsx:3419-3428`, `:4657-4667`; `constants/surface.ts:26`
- Fix: 13/700 label, 2px border (or the MODAL_PILL recipe), minHeight 44.

#### UX-8.16 · P3 · Spot-select camera padding is fixed at top 460
- Sources: layout-responsive-9
- Where: `components/map/MapView.tsx:2610-2616`
- Fix: scale the padding with the container height.

#### UX-8.17 · P3 · The dog's speech bubble is not clamped to the viewport
- Sources: layout-responsive-20
- Where: `components/ui/SpeechBubble.tsx:59-83`; `components/map/MapView.tsx:3441-3458`
- Fix: measure and apply a horizontal `dx` clamp.

#### UX-8.18 · P3 · The live distance pill wobbles on every GPS tick
- Sources: typography-31
- Where: `components/map/MapView.tsx:~4165-4180`
- Fix: `minWidth: 72, textAlign: center`.

#### UX-8.19 · P3 · The "+1" collect burst is 14px with off-palette green and orange
- Sources: typography-46
- Where: `components/map/CollectBurst.tsx:64-66`
- Fix: TYPE.small or body, `colors.amber`, and a named green token if green is wanted.

### Theme 9: Buttons, tap targets and shared recipes

#### UX-9.1 · P1 · `hitSlop` does nothing on react-native-web 0.19; the deck counter (the only way into "see all") is a ~17px text target
- Sources: spacing-borders-26, spacing-borders-27, spacing-borders-5
- Where: `components/ui/QuestPill.tsx:54`, `:124-131`; `components/ui/CardStack.tsx:575-585`, `:578`, `:719`; `app/(tabs)/tasks.tsx:633`, `:694`, `:724`; `app/(tabs)/spots.tsx:285`; `app/(tabs)/index.tsx:179`; `app/(tabs)/profile.tsx:112`, `:225`
- Note: spacing-borders-5's suggested fix (add `hitSlop={8}` to the edit chip) **will not work**, for the reason in this item.
- Fix: remove every `hitSlop` and use padding plus a matching negative margin: counter `paddingVertical: S.m, paddingHorizontal: S.l, marginVertical: -S.m`; QuestPill close 44x44 with `marginVertical: -9`; edit chip the same pattern.

#### UX-9.2 · P1 · The disabled "searching…" pill on the pet card is white-on-translucent over a white map and cannot be read
- Sources: consistency-patterns-1, user-paths-24, layout-responsive-12, a11y-interaction-7, spacing-borders-40
- Where: `components/ui/LostDogModal.tsx:97-107`, `:222`, `:366-371`; `constants/buttons.ts:79-86`; `lib/crayonStyle.ts:57`
- Fix: base it on MODAL_PILL_DISABLED (`#f0f0f0 / #777 / 2px #ddd`) with PILL_BASE sizing and the `SURFACE.onPhoto` shadow.

#### UX-9.3 · P2 · Four disabled-button treatments, and the shared token is never used
- Sources: spacing-borders-8, consistency-patterns-12, a11y-interaction-15, spacing-borders-52
- Where: `constants/buttons.ts:79` (zero importers); `components/ui/AccountDoor.tsx:260`; `components/ui/LostFlowModal.tsx:568-571`; `components/map/SniffPress.tsx:585`; `components/ui/AccountEditSheet.tsx:293-297` (the presence toggle shows no busy state)
- Fix: `disabled ? MODAL_PILL_DISABLED : MODAL_PILL_DARK` in AccountDoor and LostFlowModal. Dim the presence pills while busy. Leave the LostDogModal on-photo case to UX-9.2.

#### UX-9.4 · P2 · Modal pills have no minHeight; text-only ones are about 36px, and modal closes are 36px
- Sources: spacing-borders-2, a11y-interaction-13
- Where: `constants/buttons.ts:22-40`; `components/ui/PostModal.tsx:292`, `:297`; `components/ui/LostFlowModal.tsx:292`, `:306`, `:437`, `:441`, `:559`, `:564`, `:571`, `:574`; `components/ui/SpotModal.tsx:204-205`; `components/ui/LostDogsModal.tsx:106-107`
- Fix: `minHeight: 44, boxSizing: 'border-box'` on MODAL_PILL_BASE (the species toggles grow too, which is acceptable). Close hit areas become 44, keeping the 36 visual ring.

#### UX-9.5 · P2 · Close buttons come in five-plus shapes, glyphs and sizes
- Sources: typography-11, spacing-borders-6, consistency-patterns-9, spacing-borders-30
- Where: `components/map/MapView.tsx:4192-4215` (nav ✕ 44 circle, glyph not in Annex); `components/ui/SpotModal.tsx:204`, `:218`, `:223`; `components/ui/AboutModal.tsx:178`, `:197`, `:202`; `components/ui/LostDogsModal.tsx:101`, `:120`; `components/ui/LeaderboardModal.tsx:158`, `:177`; `components/ui/SpotsCategoryModal.tsx:116`, `:135`; `components/map/DogPrompt.tsx:101-128` (52px rounded square ×); `components/ui/QuestPill.tsx:124-137`; `components/map/PlayerCard.tsx:152`, `:170` (text link); `components/Icon.tsx:29`, `:62` (an unused `close` icon); offsets top 12/right 12 vs top 14/right 18
- Fix: **DECISION NEEDED (canonical close)**: (a) a 44px R.pill circle with HandDrawnFrame and a `×` glyph at TYPE.display in Annex; (b) the same shape with `<Icon name="close">`; (c) keep DogPrompt's 52px square as a separate "answer-row close". Minimum regardless of choice: `✕` → `×` at MapView, localized aria-labels (UX-4.8), and the font reset from UX-11.1.

#### UX-9.6 · P2 · Primary actions sit on tiny text targets: account links, "read the post", lore "more ▾", lore heart
- Sources: spacing-borders-4, spacing-borders-3, typography-37, spacing-borders-28, typography-38, consistency-patterns-46, a11y-interaction-38
- Where: `components/ui/AccountDoor.tsx:215` (LINK, used at `:603`, `:618`, `:621`, `:663`, `:668`, `:695`, `:732`, `AccountEditSheet.tsx:275`, `:339`, `:350`, `:354`, `AvatarStudio.tsx:162`, `:172`, `:182`, `PlayerCard.tsx:170`); `components/ui/LostDogModal.tsx:326-343` (11px, `colors.sniffBlue`, padding 0; ink rule at `CardStack.tsx:724-726`); `components/map/LoreMore.tsx:404-425` (11px, 0.7 opacity), `:450-465` (heart is 34px against a "~40" comment)
- Fix: padding with a negative margin to about 40px, `display: inline-flex`, TYPE.small. "Read the post" goes to ink colour. Lore toggle opacity 0.85 plus `aria-expanded`, `tabIndex` and Enter/Space. Heart padding 11.

#### UX-9.7 · P2 · HUD exit pills (cancel walk, abandon quest, GPS) have no drawn edge, no pop, and are about 36px tall
- Sources: spacing-borders-7, consistency-patterns-18
- Where: `components/map/MapView.tsx:4272-4299`; `constants/buttons.ts:97-115`
- Fix: `<HandDrawnFrame radius={R.pill}/>` in each. `playPopThen` on the interactive ones. `minHeight: 40` plus inline-flex centring on HUD_OVERLAY_PILL. Consider `<button>` elements (see UX-14.2).

#### UX-9.8 · P2 · The primary button swaps sides between sheets, and between two steps of the report flow
- Sources: spacing-borders-41, consistency-patterns-11
- Where: `components/ui/LostFlowModal.tsx:289-306` (pin step: dark on the right), `:571-577` (form: dark on the left); `components/ui/LostDogModal.tsx:351-373` (dark on the right); `components/ui/SpotModal.tsx:272-284` and `components/ui/PostModal.tsx:289-297` (dark on the left)
- Fix: **DECISION NEEDED (button order)**. The recommendation is dark primary on the left: it is the majority, and the verifier notes consistency-patterns-11 had the direction backwards. That means swapping LostDogModal and the LostFlowModal pin step, then documenting the rule in `constants/buttons.ts`.

#### UX-9.9 · P3 · LostDogModal forks its own pill recipe (10x18 padding, no flex:1)
- Sources: spacing-borders-25, consistency-patterns-35, typography-10 (LostDogModal half, which the verifier refuted as deliberate)
- Where: `components/ui/LostDogModal.tsx:55-80`, `:348-373`; header of `constants/buttons.ts`
- Note: PILL_BASE is documented as heavier because it sits on a photo background. The stale comment about sitting "ON the photo" (`:58-62`) should be updated whichever way this goes.
- Fix: spread MODAL_PILL_DARK/LIGHT, keep the on-photo shadow, and delete PILL_BASE. Low priority.

#### UX-9.10 · P3 · Account-form button labels are 15px; every other modal pill is 13px
- Sources: typography-10, consistency-patterns-55
- Where: `components/ui/AccountDoor.tsx:260`, `:272-273`, `:523`; reused in `components/map/PlayerCard.tsx:167` and AvatarStudio
- Fix: remove the `fontSize: TYPE.body` override.

#### UX-9.11 · P3 · The dog's answer pills use two recipes (RadialMenu 60/700 with its own shadow vs DogPrompt 52/800 with SURFACE.shadow)
- Sources: spacing-borders-31, consistency-patterns-51
- Where: `components/map/RadialMenu.tsx:251-275`; `components/map/DogPrompt.tsx:100-118`; `constants/radius.ts:31-32` (stale "capsule" comment)
- Fix: RadialMenu text answers get weight 800 and `SURFACE.shadow`. Keep both heights. Fix the radius.ts comment.

#### UX-9.12 · P3 · The sniff "let's go here" CTA uses its own recipe
- Sources: spacing-borders-34
- Where: `components/map/SniffPress.tsx:564-587`
- Fix: spread MODAL_PILL_DARK, keeping padding 10/18 and SURFACE.shadow.

#### UX-9.13 · P3 · Segmented toggles reuse the dark CTA for "selected", so three identical black buttons appear on one sheet
- Sources: spacing-borders-42
- Where: `components/ui/AccountEditSheet.tsx:219`, `:297`, `:348`; `components/ui/AccountDoor.tsx:523`; `components/ui/LostFlowModal.tsx:386`
- Fix: **DECISION NEEDED**: keep filled-dark for selected (a common pattern), or add MODAL_SEGMENT_ON/OFF (light plus greyBg fill plus a check mark).

#### UX-9.14 · P3 · Shadow drift: the white pill casts twice the shadow of the dark one next to it, and the tab bar still has the old HUD shadow
- Sources: spacing-borders-21, spacing-borders-49
- Where: `constants/buttons.ts:39`, `:68`; `constants/surface.ts` (SURFACE.chip); `app/(tabs)/_layout.tsx:197-201` vs `components/ui/StatusBar.tsx:327-330`
- Fix: MODAL_PILL_BASE uses SURFACE.chip and the LIGHT override goes. The tab bar moves to {0,6}/0.14/20, or its comment is fixed. Leave the marker shadows.

#### UX-9.15 · P3 · Tap "pop" feedback is applied unevenly to identical controls
- Sources: consistency-patterns-39
- Where: `app/(tabs)/tasks.tsx:581`, `:609-611`; `components/ui/LeaderboardModal.tsx:136`; `components/ui/PostModal.tsx:297`; `components/ui/LostFlowModal.tsx:292`, `:437`, `:441`, `:564`, `:571`, `:574`
- Fix: add `onPressIn={popPressableEvent}` or `playPopThen` on those.

#### UX-9.16 · P3 · Haptics fire only in multiplayer, not on the core actions
- Sources: consistency-patterns-21
- Where: `components/map/PlayerCard.tsx:84`, `:98`; `components/map/PokeToast.tsx:39`; `components/map/OtherWalker.tsx:152`, `:159`
- Fix: `haptic('success')` on a successful sighting report and `haptic('medium')` on search start.

#### UX-9.17 · P3 · Emoji glyphs are used where the Icon set already has the icon; the two map action cards have different button anatomy
- Sources: consistency-patterns-16
- Where: `components/ui/QuestPill.tsx:39`; `components/map/MapView.tsx:4276`; `components/ui/SwipeHintCallout.tsx:42`; `components/map/LoreMore.tsx:467`; `components/ui/LostDogModal.tsx:351-369` vs `SpotModal.tsx:271-290`
- Fix: `<Icon name="search">` in QuestPill. Add `eyes` and `search` icons to the LostDogModal pills. Leave the profile "?" as it is.

#### UX-9.18 · P3 · Inactive tab icons are grayscale at 32% opacity (about 2:1)
- Sources: a11y-interaction-46
- Where: `app/(tabs)/_layout.tsx:35-36`, `:188`
- Fix: raise opacity to 0.5 and keep the grayscale. This reverses a deliberate choice, so the owner should agree.

#### UX-9.19 · P2 · Tapping a peeking neighbour card opens the centre card
- Sources: a11y-interaction-18
- Where: `components/ui/CardStack.tsx:391-407`, `:423-426`
- Fix: pass `e.x`, and step the deck when the tap falls outside the centre card's span.

#### UX-9.20 · P3 · Swiping between nearby pets on the pet card is touch-only and has no visible hint
- Sources: a11y-interaction-14
- Where: `components/ui/LostDogModal.tsx:230-231`
- Fix: pointer events instead of touch, ArrowLeft/Right handling, and optional ‹ › buttons.

#### UX-9.21 · P3 · The lost-pet preview has no visible close
- Sources: user-paths-51, consistency-patterns-30 (the LostFlowModal half is refuted: that sheet has close pills)
- Where: `components/ui/LostDogModal.tsx:196`, `:216-222`, `~256`
- Fix: a 36/44px × in the top-right of the bubble with `aria-label={t.modals.common.close}` (follow the UX-9.5 decision).

### Theme 10: Surfaces, colour and borders

#### UX-10.1 · P2 · The legacy beige/charcoal palette survives on the crash screen, invite gate and post reader
- Sources: spacing-borders-12, typography-17, consistency-patterns-34, typography-26, consistency-patterns-22
- Where: `components/ui/ErrorBoundary.tsx:85-104` (consistency-patterns-34 cited `:162`, which does not exist); `components/ui/InviteGate.tsx:39-66`, `:49-60`; `components/ui/PostModal.tsx:185`, `:206`, `:210`, `:214`, `:218`, `:244`, `:248`, `:261`, `:265`; `components/ui/ConnectionBanner.tsx:66-68`; `app/dev.tsx` (dev-only, leave as is)
- Fix: `#2B2B26`→INK, `#5A5750`/`#8A867C`→`colors.grey`, `#F3F0E7`→`SURFACE.fill` (page) or `colors.greyBg` (callout), `#A2452F`→`colors.red`. Titles `TYPE.hero`/800, TYPE.small for the hints, and an INK button with white text.

#### UX-10.2 · P2 · Error text is styled four ways
- Sources: spacing-borders-11, consistency-patterns-13, typography-30
- Where: `app/(tabs)/chat.tsx:599`; `app/(tabs)/profile.tsx:629`; `components/ui/PostModal.tsx:210`; `components/ui/AccountDoor.tsx:228-233` (exported ERROR); `components/ui/LostFlowModal.tsx:500-518` (redBg box)
- Fix: add a shared ERROR_TEXT (colors.red, TYPE.small, one weight) and use it for the bare errors. Keep the redBg box for form errors.

#### UX-10.3 · P2 · Secondary grey text uses about eight ad-hoc greys, and a done task's count gets darker
- Sources: typography-27, spacing-borders-33, a11y-interaction-17
- Where: `app/(tabs)/tasks.tsx:1017`, `:1046-1048`, `:1060`, `:1107-1114`, `:1133`, `:1150`, `:1160`; `app/(tabs)/profile.tsx:602`, `:620`; `components/ui/BoardRow.tsx:115`; `components/ui/AboutModal.tsx:163`, `:209`, `:256`; `components/ui/LoreFavouriteCard.tsx:204`; `components/ui/QuestPill.tsx:133`
- Fix: secondary text goes to `colors.grey`, faded or done text to `colors.greyLight`. `countDone` becomes greyLight.

#### UX-10.4 · P3 · Sibling top sheets use three different scrims
- Sources: spacing-borders-9, consistency-patterns-10, z-index-25
- Where: `components/ui/AboutModal.tsx:94`; `components/ui/PostModal.tsx:122`; `components/ui/LostFlowModal.tsx:323`, `:325`; SpotModal and LostDogModal are transparent by design
- Fix: **DECISION NEEDED (value)**: `SURFACE.scrim` = `rgba(20,20,15,0.45)` (the majority) or `rgba(0,0,0,0.3)`. Apply it to About, Post and LostFlow.

#### UX-10.5 · P3 · Sibling top sheets use different inner padding (16 / 22 / 24)
- Sources: spacing-borders-10, consistency-patterns-24
- Where: `components/ui/SpotModal.tsx:231`, `:266-267`; `components/ui/AboutModal.tsx:151-152`, `:223`; `components/ui/PostModal.tsx:176`, `:199`, `:277`
- Fix: S.l gutters as listed in the sources.

#### UX-10.6 · P3 · Nested controls reuse the card's 18px corner
- Sources: spacing-borders-18
- Where: `components/ui/LostFlowModal.tsx:79`, `:467`; `components/ui/AccountDoor.tsx:188`; `app/(tabs)/profile.tsx:509-520`, `:232`; `constants/radius.ts:14-29`
- Fix: FIELD_PAPER and the photo preview go to R.button, and the edit chip to R.label.

#### UX-10.7 · P3 · The two Field recipes are copies with different padding
- Sources: spacing-borders-19
- Where: `components/ui/AccountDoor.tsx:193-205`; `components/ui/LostFlowModal.tsx:90-104`
- Fix: import Field from AccountDoor and settle on one padding (S.s).

#### UX-10.8 · P3 · The "you" blue comes in two strengths
- Sources: spacing-borders-22
- Where: `app/(tabs)/tasks.tsx:1106`, `:1155`; `components/ui/BoardRow.tsx:138`; `components/ui/LeaderboardModal.tsx:124`
- Fix: `colors.blue`.

#### UX-10.9 · P3 · The dog's voice bubbles drift in size, border, padding, line-height and alignment
- Sources: spacing-borders-23, consistency-patterns-54, spacing-borders-37, typography-28, typography-47, spacing-borders-51
- Where: `components/ui/SpeechBubble.tsx:59-87` (no border, 12/10); `components/map/MapView.tsx:4400-4432` (mirror: has a border, no centring); `components/map/SniffPress.tsx:519`, `:638`; `components/map/WalkStops.tsx:184-190`; `app/(tabs)/chat.tsx:555-585` (line-height 24, CARD_SHADOW, assistant has a 2px border and the user bubble has none); `components/ui/LostDogModal.tsx:263` (a paper card, excluded)
- Fix: add `border: VOICE.border` to SpeechBubble. Give the mirror `textAlign: center, width: max-content`. Add `VOICE.padding` / `VOICE.lineHeight` tokens. In chat, give the user bubble a 2px transparent border (or drop the assistant's) and set line-height to 21. Unifying the chat padding is optional.

#### UX-10.10 · P2 · The same landmark story switches from white paper to a black voice bubble once it becomes a walk stop
- Sources: consistency-patterns-45
- Where: `components/map/SniffPress.tsx:520-536`; `components/map/WalkStops.tsx:183-198`
- Fix: WalkStops uses the paper recipe (SURFACE.fill, INK, R.card, HandDrawnFrame, `tone="paper"`).

#### UX-10.11 · P3 · The lost-pet bubble has a ruler-straight CSS border where every other paper surface is hand-drawn
- Sources: consistency-patterns-17
- Where: `components/ui/LostDogModal.tsx:260-272`, `:269`
- Fix: a transparent border plus `<HandDrawnFrame radius={R.card}/>`.

#### UX-10.12 · P3 · The swipe hint is an off-token translucent pill that covers the spot card's rating and distance badges
- Sources: spacing-borders-38, consistency-patterns-52, typography-44
- Where: `components/ui/SwipeHintCallout.tsx:17`, `:26-42`; `components/ui/SpotCardStack.tsx:161-180`; `app/(tabs)/tasks.tsx:731`; `app/(tabs)/spots.tsx:288`
- Fix: VOICE tokens with `S.s`/`S.m` padding, and `top: 44` (or left/right 70 with wrapping).

#### UX-10.13 · P2 · Pet portraits are circles in three places and rounded squares in two; PlayerCard leaves a blank 128px hole with no portrait
- Sources: spacing-borders-43
- Where: `components/map/PlayerCard.tsx:104-113`; `components/ui/AvatarStudio.tsx:113-130`; `app/(tabs)/profile.tsx:581`; `components/ui/BoardRow.tsx:97`; `components/ui/AccountEditSheet.tsx:62`
- Fix: a placeholder fill in PlayerCard (`#f4f4f4`). **DECISION NEEDED:** make portraits circles everywhere (then set the studio preview to R.pill), or rounded squares everywhere.

#### UX-10.14 · P3 · A lost pet without a photo shows a blank white card
- Sources: consistency-patterns-56
- Where: `components/ui/LostDogCardStack.tsx:105`, `:268`; `components/ui/LoreFavouriteCard.tsx:143`
- Fix: `backgroundColor: '#eeece6'` on photoFallback.

#### UX-10.15 · P3 · Spot card badges sit at a 14px inset while the name sits at 20px
- Sources: spacing-borders-48
- Where: `components/ui/SpotCardStack.tsx:161-194`
- Fix: one S token for all of them.

#### UX-10.16 · P3 · Map HUD, quest banner and tab bar use different side gutters (12 / 28 / 16)
- Sources: spacing-borders-39
- Where: `app/(tabs)/index.tsx:296`, `:312`; `components/ui/QuestPill.tsx:73`; `app/(tabs)/_layout.tsx:166`
- Fix: S.l everywhere, with one padding layer on the quest row.

### Theme 11: Typography

#### UX-11.1 · P1 · The dog's main intent answers render in the system font, not Annex
- Sources: typography-1
- Where: `components/map/RadialMenu.tsx:230-300`; `public/index.html:136`; `components/map/Companion.tsx:1087`
- Fix: `fontFamily: SYSTEM_FONT` in renderButton, plus `button, input, textarea, select { font-family: inherit; }` in `<style id="expo-reset">`. The reset also fixes the modal `×` glyphs.

#### UX-11.2 · P2 · Only Annex Regular ships, so all 600/700/800 weights are browser-faked and look the same
- Sources: typography-2
- Where: `public/index.html:78-85`; 79 fontWeight declarations across 35 files (e.g. `tasks.tsx:977`, `BoardRow.tsx:129`, `buttons.ts:32`, `LostDogModal.tsx:277`)
- Fix: **DECISION NEEDED**: (a) obtain and ship an Annex Bold woff2 with a weight-700 `@font-face` (best, and needs the font file); (b) collapse 600 and 800 to 700 so the faking is at least uniform; (c) accept it as the house look. Do not migrate 79 call sites inside this audit.

#### UX-11.3 · P2 · Card title sizes differ across sibling decks (26 / 22 / 17)
- Sources: typography-7, spacing-borders-24, consistency-patterns-20, typography-35
- Where: `components/ui/LostDogCardStack.tsx:291-301`, `:333-336`; `components/ui/SpotCardStack.tsx:194-205`; `components/ui/LoreFavouriteCard.tsx:196`; `constants/type.ts:27-46`
- Fix: LostDog card name to `TYPE.hero`, as type.ts already assigns. The verifiers split on LoreFavouriteCard: typography-35 says hero, consistency-patterns-20 says keep title as a compact card. Pick one when landing the change (recommendation: hero with lineHeight 26, because it sits in the same CardStack on the same tab). Optionally align the bottom inset to 18.

#### UX-11.4 · P2 · Sheet titles use four sizes (15 / 17 / 19 / 26)
- Sources: typography-9, typography-36, consistency-patterns-38, typography-6
- Where: `components/ui/AccountEditSheet.tsx:168` (15); `components/ui/LostFlowModal.tsx:355-358` (17); `components/ui/PostModal.tsx:183` (17); `components/ui/LostDogModal.tsx:276-277` (19, off-scale); `components/ui/AboutModal.tsx:205` and `SpotModal.tsx:240` (26); comment at `constants/type.ts:44-46`
- Fix: **DECISION NEEDED (sheet heading scale)**: (a) top-sheet heroes (About, Spot, LostFlow) at display 26, and the form sheets (AccountEdit, Post) at title 17; or (b) every sheet at title 17 except full-screen heroes. Regardless of the choice, LostDogModal's 19 goes to a token (title 17 or hero 22), and the type.ts comment gets fixed.

#### UX-11.5 · P2 · Profile section titles are 15px while tasks and spots are 17px, despite a comment saying they match
- Sources: typography-8
- Where: `app/(tabs)/profile.tsx:561-563`; `app/(tabs)/tasks.tsx:993`; `app/(tabs)/spots.tsx:347`
- Fix: TYPE.title. Check that the 150px cards still fit (see UX-11.7).

#### UX-11.6 · P2 · Long URLs in the ad body push the post sheet sideways
- Sources: typography-13, layout-responsive-10
- Where: `components/ui/PostModal.tsx:37-42`, `:200`, `:214`
- Fix: `overflowWrap: 'anywhere'` in BODY_TEXT, and `overflowX: hidden` on the scroller.

#### UX-11.7 · P2 · Profile stat values don't truncate and spill out of the fixed 150px card
- Sources: typography-22, layout-responsive-11, spacing-borders-44
- Where: `app/(tabs)/profile.tsx:97-108`, `:317-325`, `:539-551`, `:612-622`; `i18n/strings.ts:887`
- Fix: `numberOfLines={1}` on the value, `flexShrink: 1, textAlign: right, marginLeft: S.s` on it, and `flexShrink: 0` on the label.

#### UX-11.8 · P2 · The longest explanatory text on tasks is 11px #777 (4.48:1)
- Sources: typography-23
- Where: `app/(tabs)/tasks.tsx:702`, `:1106-1110`; `i18n/strings.ts:824-825`
- Fix: TYPE.small, lineHeight 18, a darker grey.

#### UX-11.9 · P2 · The full-screen leaderboard has no heading, so territory and happiness look the same
- Sources: typography-40
- Where: `components/ui/LeaderboardModal.tsx:80-170`, `:103`, `:108`; `app/(tabs)/tasks.tsx:882`, `:891`
- Fix: an absolutely positioned title using the existing `t.tasks.happinessBoard` / `territoryBoard`.

#### UX-11.10 · P3 · Italic is faked (Annex has no italic)
- Sources: typography-15
- Where: `components/map/SniffPress.tsx:644`; `components/ui/AboutModal.tsx:273`; `components/map/LoreMore.tsx:358`
- Fix: remove `fontStyle: italic`, and use opacity for de-emphasis.

#### UX-11.11 · P3 · Symbols used in the UI are missing from Annex (✓ ★ ♥ ♡ ▾ ▴ ✕ ₴)
- Sources: typography-12
- Where: `app/(tabs)/tasks.tsx:766`, `:823`, `:861`; `components/map/WaypointMarker.tsx:55`; `components/ui/SpotModal.tsx:183`; `components/ui/SpotCardStack.tsx:94`; `components/map/LoreMore.tsx:467`; `i18n/strings.ts:780-781`; `components/map/MapView.tsx:4215`
- Fix: Icon SVGs for ✓, ★ and the hearts, `›` or nothing for the arrows, `×` for ✕.

#### UX-11.12 · P3 · Animated dots make the sniffing and typing bubbles change width every tick
- Sources: typography-16
- Where: `components/map/SniffPress.tsx:612-618`, `:650`; `app/(tabs)/chat.tsx:462-472`
- Fix: put the dots in a fixed-width span, padding with invisible dots.

#### UX-11.13 · P3 · The pre-React splash wordmark hands off to a PNG logo instead
- Sources: typography-18
- Where: `public/index.html:280-283`, `:300-303`, `:336`; `components/ui/Splash.tsx:37`
- Fix: use the same `<img>` in `#splash`, with a preload link.

#### UX-11.14 · P3 · The tally shows "3 / 6" and "3/6" in one card
- Sources: typography-19
- Where: `app/(tabs)/tasks.tsx:789`, `:860`; `components/ui/QuestPill.tsx:47`
- Fix: drop the spaces at `:789`.

#### UX-11.15 · P3 · Dead font tokens and 1.3 MB of unused Caveat PBFs
- Sources: typography-20
- Where: `constants/fonts.ts:10-15`; `public/fonts/Caveat Regular/`; `lib/crayonStyle.ts:23`, `:873`
- Fix: delete them, fix the comments, and check the service-worker precache list.

#### UX-11.16 · P3 · The PlayerCard name is weight 700 against 800 elsewhere, and its sublines use 500
- Sources: typography-32
- Where: `components/map/PlayerCard.tsx:127`, `:136`, `:158`
- Fix: 800 for the name, 400 for the sublines.

#### UX-11.17 · P3 · The pin-accuracy warning is the least readable line on the card
- Sources: typography-42
- Where: `components/ui/LostDogModal.tsx:315-324`
- Fix: TYPE.small in ink.

#### UX-11.18 · P3 · Board row meta text is heavier than the name
- Sources: typography-43
- Where: `components/ui/BoardRow.tsx:127-136`
- Fix: boardArea weight 400.

#### UX-11.19 · P3 · The voice speech bubble has no overflow-wrap
- Sources: typography-39
- Where: `components/ui/SpeechBubble.tsx:79-83`; `components/map/MapView.tsx:~4422`; `components/map/WalkStops.tsx:~188`
- Fix: `overflowWrap: 'anywhere'` on all three.

#### UX-11.20 · P3 · InviteGate, ErrorBoundary and ConnectionBanner use hardcoded sizes and a thin title
- Sources: typography-17 (sizing half)
- Where: `components/ui/InviteGate.tsx:49-60`; `components/ui/ErrorBoundary.tsx:94-103`; `components/ui/ConnectionBanner.tsx:68`
- Fix: TYPE tokens, and titles at hero/800. Land this with UX-10.1.

### Theme 12: Layout and responsiveness

#### UX-12.1 · P1 · `pickBottomInset` returns 0 outside Telegram, so the tab bar and composer sit in the iOS home-indicator strip; tab clearance is computed three ways
- Sources: layout-responsive-1, consistency-patterns-48
- Where: `services/telegram.ts:55` (isInTelegram, unused here), `:112-118`, `:126-130`; `public/index.html:41` (the SDK loads everywhere); `app/(tabs)/_layout.tsx:56`; `app/(tabs)/chat.tsx:294`; `app/(tabs)/profile.tsx:357`; `app/(tabs)/tasks.tsx:417`, `:425`
- Fix: `if (!isInTelegram()) return iosBottom;` in pickBottomInset and pickTopInset. Add a `useTabBarClearance()` hook and use it in profile and tasks.

#### UX-12.2 · P2 · The map HUD row is wider than 320px: the spots toggle is clipped and the logo overlaps the sun pill (profile HUD too)
- Sources: layout-responsive-2, runtime-4
- Where: `app/(tabs)/index.tsx:20`, `~216`, `:287-305`; `components/ui/StatusBar.tsx:24`, `:292-297`, `:305-353`; `app/(tabs)/profile.tsx:492-502`. Runtime: `h320_walk.png` (toggle at x 276-340).
- Fix: `flexShrink: 1, minWidth: 0` on the StatusBar wrap and counter. Below 360px, gap S.xs and a pill minWidth of 40. Cap the logo. Let the profile hudPills wrap.

#### UX-12.3 · P2 · The same meter pills jump about 18px vertically between the map and profile tabs
- Sources: spacing-borders-13
- Where: `app/(tabs)/profile.tsx:492-498`, `:365`; `app/(tabs)/index.tsx:131-135`, `:300`, `:306`
- Fix: export `HUD_TOP = S.xxl + (HUD_ICON_SIZE - CHIP.height)/2` from sizing.ts and use it on both screens.

#### UX-12.4 · P2 · Top sheets cap their height with 100vh, which runs past the visible area in iOS Safari
- Sources: layout-responsive-6
- Where: `components/ui/SpotModal.tsx:117`; `components/ui/AboutModal.tsx:128`; `components/ui/PostModal.tsx:158`; `components/ui/LostFlowModal.tsx:343`
- Fix: `100dvh`.

#### UX-12.5 · P2 · Nowrap pill pairs overflow their sheets at 320-375px (SpotModal, LostFlowModal photo/pin row and done row)
- Sources: layout-responsive-7, layout-responsive-19
- Where: `constants/buttons.ts:17-39`; `components/ui/SpotModal.tsx:262-290`; `components/ui/LostFlowModal.tsx:339-352`, `:447-458`, `:552-566`; `i18n/strings.ts:1092`
- Fix: `minWidth: 0` plus an ellipsis span, or `whiteSpace: normal` with centred wrapping. Optionally `flexWrap` on the row. Shorten `doneShare`.

#### UX-12.6 · P2 · Standing rows leave about 34px for names at 320px (about 74 at 360)
- Sources: layout-responsive-28
- Where: `components/ui/BoardRow.tsx:31`, `:80`, `:89`, `:112`, `:219`; `app/(tabs)/tasks.tsx:1098`; `components/ui/LeaderboardModal.tsx:29`
- Fix: below 400px, portrait 56, TerritoryMini 64, index columns 64, gap S.s.

#### UX-12.7 · P2 · Tasks cards taller than the screen (quest history, daily card) cannot be scrolled to their tails
- Sources: layout-responsive-18
- Where: `app/(tabs)/tasks.tsx:743-771`, `:907-915`, `:925`, `:960-966`; server `routes/quests.ts:174` (HISTORY_LIMIT 20)
- Fix: show 3 history rows plus "show all" (the fullscreen-list pattern).

#### UX-12.8 · P2 · The spots tab still uses the old snap layout the tasks tab dropped
- Sources: spacing-borders-32, layout-responsive-25, consistency-patterns-36
- Where: `app/(tabs)/spots.tsx:313-338`, `:319`, `:329`, `:330`; `app/(tabs)/tasks.tsx:414-425`, `:544`, `:925-966`
- Fix: port pageH and tailPad, `minHeight: pageH` plus centred cards, scrollPaddingTop 0, and drop the vh padding and the gap.

#### UX-12.9 · P2 · The account edit sheet goes off-screen upward when an Android or Telegram keyboard resizes the viewport
- Sources: layout-responsive-29
- Where: `components/ui/AccountEditSheet.tsx:178-185`; `hooks/useVisibleHeight.ts:22-23`; `components/ui/AccountDoor.tsx:68`
- Fix: `maxHeight: calc(100% - DOG_ROOM - S.m - env(safe-area-inset-bottom))`, or hang the sheet from the top.

#### UX-12.10 · P2 · Profile: the dog's floor ignores the deck's bottom margin, so its feet sit behind the stat cards on short screens
- Sources: layout-responsive-31
- Where: `app/(tabs)/profile.tsx:385`; `components/ui/CardStack.tsx:557`, `:677`; `components/profile/ProfileDogScene.tsx:266-270`
- Fix: export `DECK_OFFSET` (32) from CardStack and add it to the floor.

#### UX-12.11 · P2 · On desktop, portaled elements escape the 430px phone column, and 431-899px is uncapped
- Sources: layout-responsive-8, z-index-16, consistency-patterns-47, layout-responsive-22
- Where: `public/index.html:179-188`; `components/map/MapView.tsx:3441`, `:4337-4353`, `:4400-4404`; `components/ui/LostDogsModal.tsx:59`, `:84-88`; `components/ui/LeaderboardModal.tsx:83`; `components/ui/SpotsCategoryModal.tsx:61-66`, `:93-97`; the sheets' `maxWidth: 460`
- Fix: **DECISION NEEDED**: (a) a single `#portal-root` sized like `#root` that every createPortal targets (clean, touches every portal); (b) per-component caps at 430 plus chip coordinates computed from the map container rect. Also decide whether to lower the 900px breakpoint to 600 (landscape, tablets).

#### UX-12.12 · P3 · The SpotModal footer is clipped in landscape or on short windows
- Sources: layout-responsive-13
- Where: `components/ui/SpotModal.tsx:117`, `:141-150`; `public/manifest.webmanifest:8`
- Fix: hero height `min(220px, 30vh)`.

#### UX-12.13 · P3 · Top-anchored sheets pad their footer with the bottom safe-area inset
- Sources: layout-responsive-14
- Where: `components/ui/PostModal.tsx:272-277`; `components/ui/LostFlowModal.tsx:546`
- Fix: drop the `env()` term.

#### UX-12.14 · P3 · useVisibleHeight ignores resize
- Sources: layout-responsive-15
- Where: `hooks/useVisibleHeight.ts:22`; `app/(tabs)/tasks.tsx:415`; `components/ui/AccountEditSheet.tsx:185`
- Fix: listen for resize when no input is focused, and for Telegram's `viewportChanged` with `isStateStable`.

#### UX-12.15 · P3 · Card decks are a fixed 320px wide, so side peeks are off-screen at 320-360px
- Sources: layout-responsive-26
- Where: `components/ui/CardStack.tsx:44`, `:263`
- Fix: `cardWidth = min(CARD_W, width - 2*S.l - 2*S.xs)`, passed through by the callers.

#### UX-12.16 · P3 · PlayerCard at 320px leaves the territory label about 32px
- Sources: layout-responsive-30
- Where: `components/map/PlayerCard.tsx:104`, `:152-154`
- Fix: below 360px, portrait 96 and MINI 64, plus `overflowWrap` on the label.

#### UX-12.17 · P3 · The three named-spot choices wrap 2+1 below about 372px, and names are hard-cut at 16 characters
- Sources: layout-responsive-33
- Where: `components/map/RadialMenu.tsx:206`, `:389`; `components/map/Companion.tsx:57`, `:1088`
- Fix: percentage cell widths when labels show, and drop the `.slice(0,16)`.

#### UX-12.18 · P3 · The full-screen list modals start their content at different heights (+60 vs +72)
- Sources: spacing-borders-20, consistency-patterns-32
- Where: `components/ui/LeaderboardModal.tsx:103`; `components/ui/LostDogsModal.tsx:75`; `components/ui/SpotsCategoryModal.tsx:87`
- Fix: +60 everywhere, via a shared `FULLSCREEN_LIST_TOP`, with S.xl padding.

#### UX-12.19 · P3 · The favourites deck counter is inert while every other deck counter opens "see all"
- Sources: consistency-patterns-37
- Where: `app/(tabs)/spots.tsx:245-250`; `components/ui/CardStack.tsx:587`
- Fix: optional, needs a favourites mode in SpotsCategoryModal. It is fine as it is.

#### UX-12.20 · P3 · The territory card's "show all" appears when the board already fits
- Sources: consistency-patterns-23, user-paths-52, a11y-interaction-53
- Where: `app/(tabs)/tasks.tsx:143`, `:632-639`, `:686`, `:693`
- Fix: guard it with `board.board.length > BOARD_CARD_ROWS`.

### Theme 13: Motion

#### UX-13.1 · P2 · Reduce-motion is honoured only by the camera and the profile sun; UI loops ignore it, and sheet timing and easing drift (240 vs 280 ms)
- Sources: consistency-patterns-14, a11y-interaction-12, consistency-patterns-49
- Where: `utils/motion.ts`; `utils/popOnTap.ts:37`; `public/index.html:321`; `components/profile/ProfileSceneBackdrop.tsx:600-603`; `components/ui/SwipeHintCallout.tsx:41`; `components/ui/StatusBar.tsx:70`; `app/(tabs)/index.tsx:201`; `components/ui/CardStack.tsx:654`; `components/ui/LostDogCardStack.tsx:169`; `components/map/MapView.tsx:352`, `:3554`; `components/map/TokenMarker.tsx:61`; `components/map/FoodMarker.tsx:56`; `components/map/UserMarker.tsx:21`; `components/map/WaypointMarker.tsx:51`; `components/map/PokeToast.tsx:74`; `components/profile/ProfileSceneBirds.tsx:185-411`; `app/(tabs)/profile.tsx:90`; SHEET_ANIM_MS in `LostDogModal.tsx:49` and the three list modals (240) vs `SpotModal`/`AboutModal`/`PostModal`/`LostFlowModal`/MapView `DECK_ANIM_MS` (280)
- Fix: `@media (prefers-reduced-motion: reduce){[data-loop]{animation:none!important}}` in index.html, with `data-loop` on the loops. Have playPop skip the animation but still run the callback. Put one `MOTION.sheetMs = 280` in utils/motion. **Do not** globally set `animation: none` on the sheets: their unmount waits on the out-animation or timer, so shorten the duration instead.

### Theme 14: Accessibility (keyboard and screen reader)

#### UX-14.1 · P3 · Escape closes only AccountEditSheet, though its comment says "like every sheet"
- Sources: dismissal-state-16, a11y-interaction-9, consistency-patterns-31
- Where: `components/ui/AccountEditSheet.tsx:155-163`; no handler in LostDogModal (`:215`), SpotModal (`:68`), LostFlowModal (`:317`), AboutModal (`:90`), PostModal (`:118`), the list modals or PlayerCard
- Fix: add `hooks/useEscapeToClose` (can share UX-2.5's hook), plus `role="dialog" aria-modal="true"` on the panels, and fix the comment.

#### UX-14.2 · P3 · Many `role="button"` controls can't be operated from the keyboard
- Sources: a11y-interaction-10
- Where: `components/map/MapLibreMarker.tsx:167`; `components/map/PoiMarker.tsx:54-55`; `components/map/LostDogMarker.tsx:128-129`; TokenMarker, FoodMarker; `components/map/Companion.tsx:1025-1027`; `components/map/MapView.tsx:4182`, `:4281`, `:4291`, `:4332`, `:4506`; `components/map/WalkStops.tsx:209`
- Fix: an Enter/Space keydown in MapLibreMarker. Turn the HUD divs into `<button type="button">`.

#### UX-14.3 · P2 · Hidden HUD and menu controls stay focusable and activatable
- Sources: a11y-interaction-27
- Where: `components/map/RadialMenu.tsx:306-312`; `components/map/Companion.tsx:1073-1074`; `app/(tabs)/index.tsx:153-165`, `:218-233`
- Fix: `visibility: hidden` after the exit transition, plus `aria-hidden`.

#### UX-14.4 · P3 · The dog's menu and speech are nested inside one role=button, and its questions are never announced
- Sources: a11y-interaction-28
- Where: `components/map/Companion.tsx:1024-1027`, `:1061`, `:1072`; `components/ui/SpeechBubble.tsx`
- Fix: keep only the sprite as the button, render the bubble and menu as siblings, and add `role="status" aria-live="polite"` to the bubble. Keep the gesture shielding.

#### UX-14.5 · P3 · The HUD happiness and hunger meters have no accessible name or value
- Sources: a11y-interaction-29
- Where: `components/ui/StatusBar.tsx:171-179`, `:296-297`
- Fix: `accessibilityRole="progressbar"` with a label and value on the pill View.

#### UX-14.6 · P3 · Card decks can't be used with a keyboard or screen reader
- Sources: a11y-interaction-31
- Where: `components/ui/CardStack.tsx:556-585`
- Fix: `tabIndex`, `role="group"`, arrow keys step the deck, Enter taps.

#### UX-14.7 · P2 · The owner's phone number in the ad can't be tapped, and the text can't be selected
- Sources: a11y-interaction-34
- Where: `components/ui/PostModal.tsx:213-215`; `public/index.html:~297` (global user-select none); `linkify` exists in chat.tsx
- Fix: wrap phone matches in `tel:` links, and set `userSelect: text` on the body.

#### UX-14.8 · P2 · "Open original" and chat links use window.open, which telegram.ts documents as broken inside the Mini App
- Sources: a11y-interaction-43
- Where: `components/ui/PostModal.tsx:291`; `app/(tabs)/chat.tsx:449`; `services/telegram.ts:140-160`
- Fix: `openExternal(url)`: t.me links go to openTelegramChat, others to `wa.openLink`, falling back to window.open.

#### UX-14.9 · P2 · Lost-pet pins and place pins are nameless buttons
- Sources: a11y-interaction-45
- Where: `components/map/LostDogMarker.tsx:128-129`; `components/map/PoiMarker.tsx:54-55`
- Fix: `aria-label={name}`.

#### UX-14.10 · P3 · Chat replies are never announced
- Sources: a11y-interaction-48
- Where: `app/(tabs)/chat.tsx:320-332`; pattern at `components/ui/ConnectionBanner.tsx:41`
- Fix: `accessibilityLiveRegion="polite"` on the latest assistant bubble.

#### UX-14.11 · P2 · The rows in the "see all" sheets are bare divs
- Sources: a11y-interaction-49
- Where: `components/ui/LostDogsModal.tsx:84-86`; `components/ui/LeaderboardModal.tsx:132-139`; check the SpotsCategoryModal rows too
- Fix: `<button type="button" aria-label=…>` with the default button chrome reset. The close labels are covered in UX-4.8.

#### UX-14.12 · P3 · Species pills don't expose their selected state
- Sources: a11y-interaction-50
- Where: `components/ui/AccountDoor.tsx:517-519`; `components/ui/AccountEditSheet.tsx:213-215`; `components/ui/LostFlowModal.tsx:383-385`
- Fix: `aria-pressed`. Keep toggle-off on the account forms, where it is the only way to say "no pet".

#### UX-14.13 · P3 · Text inputs have no visible focus and no programmatic label
- Sources: a11y-interaction-19
- Where: `components/ui/LostFlowModal.tsx:100-101`, `:396-428`; `components/ui/AccountDoor.tsx:198-205`, `:589`
- Fix: `aria-label` per input, and a `[data-field]:focus-within` outline in index.html.

#### UX-14.14 · P3 · The deck counter link has no role or label
- Sources: a11y-interaction-52
- Where: `components/ui/CardStack.tsx:575-584`
- Fix: `accessibilityRole="button"` and a `counterA11yLabel` prop (use `t.tasks.boardSeeAll`; there is no `t.common.seeAll`).

#### UX-14.15 · P3 · Tapping the profile dog to bark is hidden inside role=img
- Sources: a11y-interaction-41
- Where: `components/profile/ProfileDogScene.tsx:395`, `~431`
- Fix: move role=img onto the backdrop, and make the dog a labelled button.

---

## 3. Fix plan

Rules for every batch, from CLAUDE.md:
- Work on the session branch. Each batch is one commit. Open a PR when done; the owner merges. Pushing to `main` deploys to production.
- Run `pnpm -r typecheck` and `pnpm -r lint` before the PR. The baseline is **22 `react-hooks/exhaustive-deps` warnings, 0 errors**. Re-measure it on `origin/main` in a scratch worktree rather than trusting that number.
- **Never exercise a write flow (sighting, lost-pet report, finish search, quest advance, poke) against production.** Verify those against a local server and database. The `sightings`, `lost_dogs` and `users` tables hold real people's data.
- Batches that touch the server (B1's `force` gate, and optionally a server-side sighting dedupe) deploy on merge and need explicit owner approval.

Batches are ordered by highest severity first, then grouped by file to keep merge conflicts down. Where two batches touch `MapView.tsx`, they edit separate regions; land them in order.

| # | Batch | Items | Files touched | Risk | How to verify |
|---|---|---|---|---|---|
| B1 | **Dead ends: navigation always reachable** (P0) | UX-2.1, 2.4, 2.8, 2.9, 2.12, 2.14 | `app/(tabs)/_layout.tsx`, `components/map/MapView.tsx` (mapProblem effect, fallback chip, empty deck), `stores/gameStore.ts` (syncMap `lostDogsLoaded`), `app/(tabs)/spots.tsx`, `app/(tabs)/tasks.tsx`, new `app/+not-found.tsx`, `components/map/Companion.tsx` (intro hint gate) | Low-medium. The hidden-tab-bar rule is central; changing it can leak the bar into the gate. | Block tiles in devtools, then confirm tabs appear. Deny geolocation, then confirm the chip. Reload on /spots and /tasks with zero pets. tasks → pet → back leaves the bar visible. /nonsense redirects. |
| B2 | **Sighting and search write safety** (P1, prod data) | UX-1.1, 1.2, 1.5, 1.6, 1.7 (client only), 1.10 | `components/map/MapView.tsx` (finishSearch, leave prompt, waypoint onTap), `components/map/DogPrompt.tsx`, `components/ui/LostDogModal.tsx`, `stores/gameStore.ts` (reportSighting inFlight), `components/map/PlayerCard.tsx`, `i18n/strings.ts` (sendFailed) | Medium: the core search loop. | Local server only. Throttle to Slow 3G, double-tap yes/no, "I've seen" and poke, and check the network tab shows exactly one POST each. Kill the API mid-finish and confirm the failure prompt. Tap ✕ mid-search and confirm "keep going" exists. Waypoint tap does nothing without DEV_TOOLS. **DECISION** (confirm step on "I've seen"; server `force` gate). |
| B3 | **Lost-pet report flow** (P1, prod data) | UX-1.3, 1.4, 2.2, 2.3, 5.12 | `components/ui/LostFlowModal.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx` (logoHidden), `components/map/MapView.tsx` (screen-centre publisher, chip/marker gates on lostPinning and doorSheetUp), `stores/gameStore.ts` (setScreen, getScreenCenter slot), `components/map/Companion.tsx:631` | Medium-high: the pin position maths changes where real reports land. | Local server. In each mode (explore, play, supersniff) pin a known landmark and check the saved lat/lng is within a few metres of the crosshair. Close mid-submit (throttled) and confirm no post and a fresh form. After success, reopen and confirm the form is empty. While pinning, the tab bar, logo and chip are gone and pins don't open. |
| B4 | **Chat** (P1) | UX-2.10, 3.1-3.7, 4.5, UX-5.1 (chat half) | `app/(tabs)/chat.tsx`, `i18n/strings.ts` | Low. | Open chat and change language during boot: history loads and the dots stop. Throttle: spinner visible. Kill the API: localized error, retry works, draft restored. start_quest failure gives no navigation. |
| B5 | **Account and session hygiene** (P1) | UX-2.11, 1.11, 1.12, 1.13, 2.13, 2.18, 2.19, 2.7, 7.10, 12.9 | `app/(tabs)/profile.tsx`, `components/ui/AccountDoor.tsx`, `components/ui/AccountEditSheet.tsx`, `components/ui/AvatarStudio.tsx`, `app/_layout.tsx` (useDoorKeeper), `stores/accessStore.ts`, `stores/gameStore.ts` | Medium: auth flows. | Local server. Log out A, log in B: no A transcript or paws. "Later" mid-draw leaves no portrait. Register with a short nickname shows a specific error. Android Chrome keyboard: the edit sheet header stays visible. **DECISIONS:** reload vs reset after logout; anonymous-logout policy. |
| B6 | **HUD overlays and z-order** (P1) | UX-7.1, 7.2, 7.3, 6.1, 7.4, 7.5, 7.6, 7.7, 7.11, 7.12, 12.1 | `components/map/MapView.tsx` (overlay pill row, off-screen chip and bubble), `components/ui/QuestPill.tsx`, `components/map/PokeToast.tsx`, `components/ui/ConnectionBanner.tsx`, `components/ui/AboutModal.tsx`, `components/ui/Splash.tsx`, `app/(tabs)/index.tsx` (mapLayer), `constants/z.ts`, `services/telegram.ts`, `app/(tabs)/profile.tsx`, `app/(tabs)/tasks.tsx` (clearance hook), `i18n/strings.ts` (poke) | **High.** UX-7.4 changes global stacking, so the companion, chips and sniff bubble will start painting over the logo and pills. | Screenshot pass at 320/375/390 in every mode, with a quest plus a walk live and the dog off-screen at each edge. The installed iOS PWA shows the bar above the home indicator. Poke while a sheet is open: the toast is under it. **DECISION:** banner placement. |
| B7 | **Map interaction and marker stacking** (P1) | UX-8.1, 8.2+8.3 (together), 8.4+8.5 (together), 8.6, 8.7, 8.8, 8.9, 8.10 | `components/map/MapView.tsx` (map click handler, WalkStops gate), `components/map/OtherWalker.tsx`, `components/map/LostDogCluster.tsx`, `components/map/LostDogMarker.tsx`, `components/map/PoiMarker.tsx`, `components/map/SniffPress.tsx`, `constants/z.ts`, `utils/territoryColor.ts` | Medium-high. Removing the marker-click leak changes what closes the menu or cluster. | **On a real phone**: cluster badge toggles open and closed. Ring drill-downs (walk, meet, visit) stay open. Walkers never cover pets. Walker tags are readable in the territory view. **DECISION:** should tapping another marker close an open menu? |
| B8 | **Game logic correctness** (P1) | UX-1.8, 1.9, 2.15, 2.16, 2.17, 6.13, 12.20 | `stores/gameStore.ts` (WalkRouteMeta.destination, sync carve-out), `components/map/Companion.tsx`, `app/(tabs)/chat.tsx` (walk meta; after B4), `components/map/MapView.tsx` (onWalkHere meta), `app/(tabs)/tasks.tsx`, `components/ui/LeaderboardModal.tsx` | Medium: touches the daily-task path (server side unchanged). | Local server: plan a roundtrip ≥300 m, and the daily row ticks. Tap your own board row: no second dog. Deep-link a far pet and start a search: the pet persists. **DECISIONS:** walk arrival; standing-row tap mid-walk. |
| B9 | **Back button and Escape** (P1) | UX-2.5, 14.1 | new `hooks/useSheetBack.ts`, `services/telegram.ts`, every sheet (LostFlowModal, PostModal, SpotModal, LostDogModal, AboutModal, AccountEditSheet, LostDogsModal, LeaderboardModal, SpotsCategoryModal, PlayerCard), `app/(tabs)/tasks.tsx` and `spots.tsx` (focus gate) | Medium: history manipulation can fight expo-router. Test the web back stack carefully. | Telegram Android: back closes the top sheet, not the app, and the report form asks before closing when dirty. Web: browser back closes the sheet. Desktop: Escape closes every sheet. |
| B10 | **i18n sweep** (P1) | UX-4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 4.8, 4.9, 4.10, UX-5.7 strings | `i18n/strings.ts`, `components/map/MapView.tsx` (bubbles and barks), `components/map/Companion.tsx`, `components/map/LostDogCluster.tsx`, `app/(tabs)/tasks.tsx`, `utils/geo.ts` (+ the 3 copies removed), `app/(tabs)/index.tsx`, `components/ui/StatusBar.tsx`, `components/map/RadialMenu.tsx`, the 3 list modals, `components/map/PoiMarker.tsx` | Low-medium: wide but mechanical. Land after B2-B8, which edit the same MapView and Companion lines. | `grep` for English literals in `showBubble`/`flash`/aria. Walk the app in uk and en. Typecheck enforces the new keys in both locales. |
| B11 | **Global CSS and typography P1** | UX-11.1, 5.11, 13.1, 11.10, 11.12, 11.13 | `public/index.html` (button font reset, top-sheet and shimmer keyframes, reduced-motion rule, splash img), `components/map/RadialMenu.tsx`, `components/ui/SpotModal.tsx` / `AboutModal.tsx` (remove the keyframe copies), `app/(tabs)/profile.tsx`, `utils/popOnTap.ts`, `utils/motion.ts`, the loop components (`data-loop`), `components/map/SniffPress.tsx`, `app/(tabs)/chat.tsx` (dots) | Low. | Ring answers render in Annex. LostFlow and Post sheets slide in on their own. Profile shimmers. With OS reduce-motion on, the loops are still and sheets still close. |
| B12 | **Tap targets and disabled states** (P1) | UX-9.1, 9.2, 9.3, 9.4, 9.6, 9.7, 9.19, 9.21 | `constants/buttons.ts`, `components/ui/QuestPill.tsx`, `components/ui/CardStack.tsx`, `app/(tabs)/profile.tsx`, `app/(tabs)/tasks.tsx`, `app/(tabs)/index.tsx`, `components/ui/LostDogModal.tsx`, `components/ui/AccountDoor.tsx`, `components/ui/LostFlowModal.tsx`, `components/ui/AccountEditSheet.tsx`, `components/map/LoreMore.tsx`, `components/map/MapView.tsx` (HUD pills) | Low-medium: minHeight 44 grows every sheet's footer slightly. | Measure hit boxes in devtools (≥40-44px). The "searching…" pill is readable over the map. The deck counter is easy to tap. Peek-card tap steps the deck. |
| B13 | **Stale async and state-leak guards** (P2) | UX-6.2-6.12, 6.14, 6.15, 5.8 | `components/map/MapView.tsx`, `components/map/SniffPress.tsx`, `components/map/Companion.tsx`, `components/map/PlayerCard.tsx`, `app/(tabs)/spots.tsx`, `components/ui/SpotModal.tsx` | Medium: many small guards in hot code paths. | Throttled network. For each late-resolving call, flip mode or switch tab mid-flight and confirm nothing lands. Walk-here offline draws a straight line. |
| B14 | **Loading, empty and error states** (P2) | UX-5.1 (profile half), 5.2, 5.3, 5.4, 5.5, 5.6, 5.9, 5.10 | `app/(tabs)/profile.tsx`, `app/(tabs)/spots.tsx`, `app/(tabs)/tasks.tsx`, `stores/gameStore.ts`, `components/ui/PostModal.tsx`, `components/map/PlayerCard.tsx`, `components/map/LoreMore.tsx`, `i18n/strings.ts` | Low. | Offline: every card says "couldn't load, retry" rather than "nothing here". Retries recover when back online. |
| B15 | **Button family: decision items** (P2) | UX-9.5, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 9.14, 9.15, 9.16, 9.17, 9.18, 9.20 | `constants/buttons.ts`, `components/map/MapView.tsx` (nav close), `components/map/DogPrompt.tsx`, `components/ui/SpotModal.tsx`, `AboutModal.tsx`, the 3 list modals, `components/ui/QuestPill.tsx`, `components/map/PlayerCard.tsx`, `components/ui/LostDogModal.tsx`, `components/ui/LostFlowModal.tsx`, `components/ui/AccountDoor.tsx`, `components/map/RadialMenu.tsx`, `components/map/SniffPress.tsx`, `app/(tabs)/_layout.tsx` | Low, but visual. | Side-by-side screenshots of every sheet's close and action row. **DECISIONS:** canonical close, button order, segmented toggle, inactive-tab opacity. |
| B16 | **Surfaces and colour tokens** (P2) | UX-10.1-10.16, 11.20 | `components/ui/ErrorBoundary.tsx`, `InviteGate.tsx`, `PostModal.tsx`, `chat.tsx`/`profile.tsx` error styles, `app/(tabs)/tasks.tsx`, `components/ui/BoardRow.tsx`, `AboutModal.tsx`, `LoreFavouriteCard.tsx`, `constants/surface.ts`, `constants/voice.ts`, `components/ui/SpeechBubble.tsx`, `components/map/WalkStops.tsx`, `components/ui/SwipeHintCallout.tsx`, `components/map/PlayerCard.tsx`, `components/ui/LostDogCardStack.tsx`, `components/ui/SpotCardStack.tsx`, `components/ui/LostFlowModal.tsx`, `components/ui/AccountDoor.tsx` (Field) | Low. | Screenshots: no beige pages, one error red, voice bubbles the same size. **DECISIONS:** scrim value, portrait shape. |
| B17 | **Typography scale** (P2) | UX-11.2-11.9, 11.11, 11.14-11.19 | `public/index.html` (only if an Annex Bold file is supplied), `components/ui/LostDogCardStack.tsx`, `LoreFavouriteCard.tsx`, the sheet components, `app/(tabs)/profile.tsx`, `components/ui/PostModal.tsx`, `app/(tabs)/tasks.tsx`, `components/ui/LeaderboardModal.tsx`, glyph call sites, `constants/fonts.ts`, `public/fonts/Caveat Regular/` (delete), `lib/crayonStyle.ts`, `components/map/PlayerCard.tsx`, `components/ui/BoardRow.tsx`, `components/ui/SpeechBubble.tsx` | Low. Deleting the Caveat assets touches the SW precache list, so check it. | Screenshot pass. Profile cards don't clip at TYPE.title. A long URL in a post wraps. **DECISIONS:** faux bold; sheet heading scale; LoreFavourite title size. |
| B18 | **Layout and responsiveness** (P2) | UX-12.2-12.19, 8.11-8.19 | `app/(tabs)/index.tsx`, `components/ui/StatusBar.tsx`, `app/(tabs)/profile.tsx`, the four top sheets (dvh), `constants/buttons.ts`, `components/ui/BoardRow.tsx`, `app/(tabs)/tasks.tsx`, `app/(tabs)/spots.tsx`, `components/ui/CardStack.tsx`, `components/map/PlayerCard.tsx`, `components/map/RadialMenu.tsx`, the list modals, `hooks/useVisibleHeight.ts`, map markers (Waypoint, Food, Token, Poi, LostDog), `components/map/MapView.tsx` (retry, camera padding, distance pill), `components/ui/SpeechBubble.tsx`, `components/map/CollectBurst.tsx` | Medium: many screens at many widths. | Runtime screenshot pass at 320x640, 360x740, 375x812, 390x844, and 1440x900 desktop. **Re-run with the API reachable** so populated screens are actually covered. **DECISION:** desktop column strategy. |
| B19 | **Accessibility sweep** (P2/P3) | UX-14.2-14.15 | `components/map/MapLibreMarker.tsx`, `components/map/LostDogMarker.tsx`, `PoiMarker.tsx`, `components/map/RadialMenu.tsx`, `components/map/Companion.tsx`, `components/ui/StatusBar.tsx`, `components/ui/CardStack.tsx`, `components/ui/PostModal.tsx`, `services/telegram.ts` (openExternal), `app/(tabs)/chat.tsx`, the list modals, the account and report forms, `components/profile/ProfileDogScene.tsx`, `public/index.html` | Low. | VoiceOver and TalkBack walk-through in uk. Keyboard-only walk-through on desktop. Tap a phone number in a post. "Open original" inside Telegram. |

### Decisions needed from the owner

| # | Item | Options |
|---|---|---|
| D1 | UX-1.2: confirm before "I've seen" | (a) add a DogPrompt confirm, "saw {name} here, just now?"; (b) no confirm, only the double-tap guard |
| D2 | UX-1.7: server `force` on quest advance | (a) honour it only for dev/admin callers (server change, deploys on merge); (b) client-only gate for now |
| D3 | UX-1.13: anonymous logout | (a) replace logout with "register to keep progress"; (b) keep logout behind a confirm that warns about losing progress |
| D4 | UX-2.11: state after logout | (a) full `window.location.replace('/')`; (b) per-store reset plus keyed ChatScreen |
| D5 | UX-2.15: walk arrival | (a) auto-detect arrival and end the walk with a bubble; (b) relabel the pill "finish walk" only |
| D6 | UX-6.13: standing-row tap mid-walk | (a) keep the walk and just show territory; (b) keep current behaviour (documented rule) |
| D7 | UX-7.5: offline banner placement | (a) bottom, above the tab bar; (b) top, below the HUD row (collides with the QuestPill row) |
| D8 | UX-8.1: should tapping another marker close an open ring or cluster? | (a) yes, explicitly in marker onTap; (b) no |
| D9 | UX-9.5: canonical close button | (a) 44px circle with × glyph; (b) 44px circle with the `close` Icon; (c) as (a) but keep DogPrompt's 52px square for answer rows |
| D10 | UX-9.8: button order | (a) dark primary on the left everywhere (recommended, majority); (b) on the right everywhere |
| D11 | UX-9.13: segmented "selected" style | (a) keep filled dark; (b) a new light-plus-check segment style |
| D12 | UX-9.18: inactive tab opacity | (a) 0.5; (b) keep 0.32 (deliberate) |
| D13 | UX-10.4: scrim value | (a) `rgba(20,20,15,0.45)`; (b) `rgba(0,0,0,0.3)` |
| D14 | UX-10.13: portrait shape | (a) circle everywhere; (b) rounded square everywhere |
| D15 | UX-11.2: bold weights | (a) ship Annex Bold (needs the font file); (b) collapse to 700; (c) accept as is |
| D16 | UX-11.3 / 11.4: heading scale | card names hero 22 (LoreFavourite too?); sheet headings: (a) hero sheets at display, form sheets at title; (b) all at title |
| D17 | UX-12.11: desktop column | (a) shared `#portal-root`; (b) per-component caps; also decide whether to move the breakpoint from 900 to 600 |

---

## 4. Appendix

### A. Refuted findings (checked and dismissed)

- **z-index-15**: HUD_CHIPS deck and DogPrompt under the companion. The stacking holds, but no overlap was found: DogPrompt sits in the always-clear strip and the deck unmounts when the menu opens.
- **z-index-17**: chat's literal zIndex 5/3. These are local to the chat View's own stacking context and never compete with the global tiers.
- **spacing-borders-35**: 1px hairlines in history rows and LoreMore. These are documented, deliberate dividers.
- **z-index-22**: `MARKER_DEFAULT` never applied. The code reading is right, but the proposed fix changes nothing visible (ties still fall to DOM order). Only the z.ts comment is wrong. The real issue is in UX-8.2.
- **z-index-23**: z.ts header omits that RN-web Views are z-0 stacking contexts. The fact is true but it is documentation only. Fold it into UX-7.4's comment fix.
- **consistency-patterns-41**: the chat bubble not using VOICE tokens. VOICE is scoped to transient bubbles, and the chat already uses the same ink and border. (The 4px size difference is kept in UX-10.9.)
- **a11y-interaction-30**: non-tappable leaderboard rows look tappable. They show an empty silhouette slot, which is exactly the non-pickable condition.
- **a11y-interaction-35**: logout sits next to "done". They are at opposite ends of a space-between row, logout is hidden in Telegram, and the action is recoverable.
- **a11y-interaction-39**: the spots toggle's off state is indistinguishable. The icon opacity also drops to 0.45 and the hearts use outline vs filled glyphs, so the difference is clear.
- **spacing-borders-50**: the off-screen chip has no drawn edge. The dark disc is deliberate and clearly visible on the pastel map.
- **spacing-borders-53**: off-palette placeholder greys clash. Wrong screen (the favourites beige is intentional map paper), and the toggle grey already equals `colors.greyBg`.
- **layout-responsive-32**: the radial menu falls under the tab bar. It only happens in landscape, and the app is portrait-locked.
- **layout-responsive-34**: the supersniff card covers the dog. It only happens in landscape, and the app is portrait-locked.

Partly refuted sub-claims, kept in the main list in corrected form: typography-10 (the LostDogModal PILL_BASE half), consistency-patterns-19 (hiding the empty lost-pets card is deliberate), consistency-patterns-30 (LostFlowModal does have close pills), consistency-patterns-11 (the recommended direction was backwards), spacing-borders-5 (its hitSlop fix is a no-op), spacing-borders-4 (PlayerCard has a backdrop close), runtime-9 (no stacking tie), z-index-24 (the sheet is not a dead end, and closing on tap-out would drop edits), user-paths-7 (profile does retry on focus).

### B. Unverified findings

**None.** Every finding went through verification, and no verifier died.

The runtime screenshot pass is a separate limitation. It ran mostly with the API unreachable, so no screen populated with real data was seen at runtime (see section 1). Re-run it with a reachable **non-production** API as part of B18.
