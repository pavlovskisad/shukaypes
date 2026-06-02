// Google Maps style pair applied via the API `styles` option (NOT a
// CSS filter — that mangled photos + tanked perf on iOS Safari).
//
// Phase 1 of the "game-like map" work: a bright, friendly DAY style
// (brightMapStyle) for normal mode and a moody dark style for sniff
// mode. Park / water / natural-land colours come straight from
// Google's own landuse geometry (featureType 'poi.park',
// 'landscape.natural', 'water'), so the colour always follows the
// real boundaries at every zoom — no per-city hand-tracing, and it
// scales to anywhere automatically.
//
// Style rules cascade in array order: a broad rule sets a base, then
// later, more-specific featureType rules paint on top. So the first
// "all geometry" colour is the land fill, and parks/water/roads
// override it below.

// Greyscale day map with ONLY the green areas (parks / natural land)
// and water painted in colour — land, roads, and labels all stay
// black & white so the green + blue are the only colour on the page.
// The green/blue fills still come from Google's own landuse geometry
// (featureType poi.park / landscape.natural / water), so they follow
// the real boundaries at every zoom.
export const brightMapStyle = [
  // Base land — neutral light grey (B&W). Everything inherits this
  // until a more-specific rule below repaints water / parks / roads.
  { elementType: 'geometry', stylers: [{ color: '#e8e8e8' }] },
  // Labels: neutral grey text with a white halo.
  { elementType: 'labels.text.fill', stylers: [{ color: '#6f6f6f' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 3 }] },

  // Strip the clutter: business pins, POI + transit labels, road
  // shields, parcel/neighbourhood lines.
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },

  // Parks — the only green. Bold crayon grass-green; park name labels
  // kept (people navigate by parks here) in a deep green.
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#62bf43' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#357a25' }] },
  { featureType: 'poi.park', elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 2.5 }] },

  // Other natural land (forest / scrub / landcover) — vivid lighter
  // green so all genuinely-green areas read as colour.
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#a4dd7e' }] },

  // Water — vivid crayon marker-blue (the only blue).
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#36a6e0' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#1f7bac' }] },

  // Roads — clean white network with a grey casing. Greyscale
  // hierarchy: highways a touch darker-cased than locals so the
  // graph still reads without any colour.
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#d6d6d6' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#fcfcfc' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#c6c6c6' }] },
  { featureType: 'road.local', elementType: 'geometry.fill', stylers: [{ color: '#fafafa' }] },

  // Kill ALL labels last so it overrides any text fills set above.
  // No street names, place names, water labels, park labels —
  // navigation cues come from the colour fills + the app's own pins.
  { elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

// Sniff-mode dark style — deep charcoal land with a crisp light-grey
// road graph (the walker follows streets, so the network has to stay
// legible). Parks + water keep a muted hint of the day palette so the
// data-accurate green/blue still reads, just dimmed for the dark map.
// Uses explicit per-feature colours rather than a global desaturate so
// those tints survive.
export const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9a9a9a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0d0d0d' }, { weight: 3 }] },

  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },

  // Muted park / natural / water tints — same hues as the day map,
  // dropped way down in lightness so they sit under the dark mood.
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#2c3a29' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#5c7a4f' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#262e22' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#16242c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3f6675' }] },

  // Road network — three-tier light-grey hierarchy, each step ~10
  // lightness brighter than the last, crisp against the charcoal.
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#5a5a5a' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#6a6a6a' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#7a7a7a' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },

  // Kill ALL labels last so it overrides anything above.
  { elementType: 'labels', stylers: [{ visibility: 'off' }] },
];
