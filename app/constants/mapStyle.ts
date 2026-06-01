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

// Bright, crayon-saturated, game-like day map. Land stays a warm
// "paper" near-white so the saturated colour marks pop ON it — the
// way a hand-drawn map is coloured strokes on a page. Parks +
// water + highways carry the vivid crayon hues; POI/transit clutter
// is hidden so the pets + tokens own the attention.
export const brightMapStyle = [
  // Base land — warm paper white. Light + slightly warm so the
  // saturated park/water marks read as bold colour against it.
  { elementType: 'geometry', stylers: [{ color: '#f7f2e4' }] },
  // Default labels: soft warm-grey text with a thick paper halo so
  // they stay legible over the vivid fills.
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b6452' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f7f2e4' }, { weight: 3 }] },

  // Strip the clutter: business pins, POI + transit labels, road
  // shields. The app's own markers carry all the meaning.
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },

  // Parks — the hero colour. Bold crayon grass-green; park name
  // labels kept (people navigate by parks here) in a deep green.
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#62bf43' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#357a25' }] },
  { featureType: 'poi.park', elementType: 'labels.text.stroke', stylers: [{ color: '#f7f2e4' }, { weight: 2.5 }] },

  // Other natural land (forest / scrub / landcover) — a vivid lighter
  // green so the city edges read clearly green without overpowering
  // the parks.
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#a4dd7e' }] },

  // Water — vivid crayon marker-blue.
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#36a6e0' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#1f7bac' }] },

  // Roads — clean white network with a soft warm casing so the graph
  // reads at a glance without shouting. Highways get a bold crayon
  // yellow with an orange casing for a friendly game-map hierarchy.
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#ecdcae' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9a9079' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#ffcf3d' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#f2b134' }] },
  { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.local', elementType: 'geometry.fill', stylers: [{ color: '#fbf7e9' }] },
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
];
