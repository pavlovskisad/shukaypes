import type { CSSProperties } from 'react';
import { CLOSE_CHIP, CLOSE_GLYPH } from '../../constants/buttons';
import { R } from '../../constants/radius';
import { useStrings } from '../../i18n/useStrings';
import { playPopThen } from '../../utils/popOnTap';
import { HandDrawnFrame } from './HandDrawn';

// The app's one close button (D9) — recipe and reasoning live with the
// other button shapes in constants/buttons.ts (CLOSE_CHIP). Every sheet,
// the pet card and the nav HUD render this, so the way out is the same
// circle wherever it is.
//
// `style` is for PLACEMENT only (position / top / right / margins); the
// shape is not meant to be overridden per call site — that is how the
// five versions happened.
export function CloseButton({
  onPress,
  label,
  style,
}: {
  onPress: () => void;
  // Accessible name. Defaults to the plain «закрити»/«close»; the nav
  // HUD passes its own because there it means "leave the search".
  label?: string;
  style?: CSSProperties;
}) {
  const t = useStrings();
  const name = label ?? t.modals.common.close;
  return (
    <button
      type="button"
      // Pop, then act: almost every close unmounts the button it was
      // pressed on, and without the defer the pop never shows.
      onClick={(e) => playPopThen(e.currentTarget, onPress)}
      aria-label={name}
      style={{ ...CLOSE_CHIP, ...style }}
    >
      <HandDrawnFrame radius={R.pill} />
      {CLOSE_GLYPH}
    </button>
  );
}
