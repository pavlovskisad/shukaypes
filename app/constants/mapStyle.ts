// Greyscale Google Maps style ported from the demo.
// Applied via Google Maps API `styles` parameter — NOT CSS filter.
// saturation: -100 (fully desaturated), lightness: +5 (slight brightening).
export const greyscaleMapStyle = [
  { stylers: [{ saturation: -100 }, { lightness: 5 }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];
