import type { CSSProperties } from 'react';

// THE SYMBOLS ANNEX DOES NOT HAVE. The brand font carries ×, ›, ‹, →
// and · but not ✓ ★ ♥ ♡ (checked against its cmap), so every one of
// those used to come out of whatever system font the browser fell back
// to — a different stroke, weight and baseline on every platform, and
// the one line of type on the card not drawn in the house hand
// (UX-11.11). The designer icon set (Icon.tsx) has none of them either.
//
// So they are drawn here as tiny inline SVGs that behave like text:
// sized in em so they follow the surrounding fontSize, stroked and
// filled in currentColor so they take the text's colour, and inline so
// they sit in a <Text> or a <span> exactly where the character did.
// Round caps and joins, a 2.4 stroke on a 24 grid: about the weight of
// Annex at 700.
//
// Decorative by default (aria-hidden): every call site already says the
// thing in words or in an aria-label. Pass `label` when the glyph is
// the only thing saying it.

export type GlyphName = 'check' | 'star' | 'heart' | 'heartOutline';

const HEART =
  'M12 20.2C7 16.4 3.6 13.3 3.6 9.2 3.6 6.6 5.6 4.6 8 4.6c1.7 0 3.1.9 4 2.4.9-1.5 2.3-2.4 4-2.4 2.4 0 4.4 2 4.4 4.6 0 4.1-3.4 7.2-8.4 11z';

function shape(name: GlyphName) {
  switch (name) {
    case 'check':
      return <path d="M4.6 12.9c1.9 1.5 3.5 3.2 5 5.3 2.8-5 6-9 10.2-12.6" fill="none" />;
    case 'star':
      return (
        <path
          d="M12 2.9l2.7 5.8 6.3.8-4.7 4.3 1.3 6.2L12 16.9 6.4 20l1.3-6.2L3 9.5l6.3-.8z"
          fill="currentColor"
        />
      );
    case 'heart':
      return <path d={HEART} fill="currentColor" />;
    case 'heartOutline':
      return <path d={HEART} fill="none" />;
  }
}

export function Glyph({
  name,
  size = '0.9em',
  color,
  label,
  style,
}: {
  name: GlyphName;
  // A number is pixels; the default follows the surrounding text.
  size?: number | string;
  // Defaults to the text colour around it.
  color?: string;
  label?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        display: 'inline-block',
        // Sits on the text's baseline like the character it replaces,
        // rather than on its descender.
        verticalAlign: '-0.1em',
        flex: 'none',
        overflow: 'visible',
        color,
        ...style,
      }}
    >
      {shape(name)}
    </svg>
  );
}
