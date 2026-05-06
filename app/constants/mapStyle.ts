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
  // Road surface — slight bump above the deep-charcoal land so the
  // network reads at zoom but doesn't shout. Three-tier hierarchy
  // mirrors the day map; each step ~10 lightness brighter than the
  // last. Subtler than the previous near-white pass that made the
  // map feel less "dark".
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#5a5a5a' }] },
  {
    featureType: 'road.arterial',
    elementType: 'geometry',
    stylers: [{ color: '#6a6a6a' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#7a7a7a' }],
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
