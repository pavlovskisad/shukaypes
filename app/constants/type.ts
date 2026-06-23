// Type scale. Six sizes covering caption → display. Values are
// plain numbers — write `fontSize: TYPE.title` at the call site
// and keep fontWeight / letterSpacing / color / lineHeight local
// to the style. That way the scale rename never silently changes
// a screen's weight or kerning, and we keep the door open for a
// dedicated weight scale layered on top later if it proves
// worth it.
//
// Naming follows visual weight, not pixel size — that way a future
// retune of the actual numbers doesn't force a rename pass across
// the codebase. If you find yourself reaching for a 7th size, first
// check whether one of these adapted with a one-line override would
// do the job.

export const TYPE = {
  // Chip labels, badges, distance pills, small counts.
  caption: 11,
  // Row meta lines ("ago", "completed · +25 pts"), secondary
  // text in cards, address lines, place names on the map.
  small: 13,
  // Default body — row labels, regular paragraph text, modal
  // copy, status pills.
  body: 15,
  // Card and section titles ("кав'ярні", "щоденні квести"),
  // chat header pill.
  title: 17,
  // Big card names — spot name on a SpotCardView, dog name on
  // the LostDog card, marker name pop.
  hero: 22,
  // Modal hero — the giant name at the top of LostDogModal /
  // SpotModal info section.
  display: 26,
} as const;
