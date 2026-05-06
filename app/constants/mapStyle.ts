// Greyscale Google Maps style ported from the demo.
// Applied via Google Maps API `styles` parameter — NOT CSS filter.
// saturation: -100 (fully desaturated), lightness: +5 (slight brightening).
export const greyscaleMapStyle = [
  { stylers: [{ saturation: -100 }, { lightness: 5 }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

// Sniff-mode dark style — desaturated, then dropped lightness across
// the board so the bg / land reads as deep charcoal with streets a
// slightly brighter grey. Streets stay legible (the user is still
// trying to follow them toward a pet); labels are dimmed but kept
// because at this zoom street names are how a human navigates. Same
// POI / transit-label overrides as the day style so the map doesn't
// suddenly clutter when sniff turns on.
export const darkMapStyle = [
  { stylers: [{ saturation: -100 }, { lightness: -85 }] },
  // Streets a touch brighter than the background so the road network
  // still reads against the dark land fill.
  { featureType: 'road', stylers: [{ lightness: -65 }] },
  // Water bodies — slightly different shade so they don't merge with
  // land at a glance (Dnipro reads as a darker negative-space).
  { featureType: 'water', stylers: [{ lightness: -92 }] },
  // Labels: visible but very dim white text so they don't shout.
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
