// Greyscale Google Maps style ported from the demo.
// Applied via Google Maps API `styles` parameter — NOT CSS filter.
// saturation: -100 (fully desaturated), lightness: +5 (slight brightening).
export const greyscaleMapStyle = [
  { stylers: [{ saturation: -100 }, { lightness: 5 }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

// Sniff-mode dark style — desaturated, then dropped lightness across
// the board so the bg / land reads as deep charcoal. Streets are
// pushed back UP to a near-white grey so the road network stays
// crisp against the dark land fill (the user is following streets
// to find pets — the road graph has to read at a glance). Labels
// stay dim white. POI / transit-label overrides match the day style
// so the layer set doesn't shift when sniff toggles.
export const darkMapStyle = [
  { stylers: [{ saturation: -100 }, { lightness: -85 }] },
  // Road surface — light grey, high contrast against the deep
  // charcoal land. Use explicit `color` instead of relative
  // `lightness` so the result is predictable across base palettes.
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#bdbdbd' }] },
  // Major arteries a touch brighter so they pop above neighbourhood
  // streets — same hierarchy the day map shows.
  {
    featureType: 'road.arterial',
    elementType: 'geometry',
    stylers: [{ color: '#d4d4d4' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#e8e8e8' }],
  },
  // Water bodies — slightly darker than the land so the Dnipro reads
  // as negative space.
  { featureType: 'water', stylers: [{ lightness: -92 }] },
  // Labels: dim white text so they don't shout but stay readable
  // against the darker bg (now even darker compared to the brighter
  // streets).
  {
    featureType: 'all',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#9a9a9a' }, { lightness: -10 }],
  },
  {
    featureType: 'all',
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#0d0d0d' }, { lightness: -20 }],
  },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];
