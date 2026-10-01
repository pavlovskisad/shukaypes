import { SYSTEM_FONT } from '../../constants/fonts';
import { TYPE } from '../../constants/type';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { VOICE } from '../../constants/voice';
import { Z } from '../../constants/z';
import { useTabBarClearance } from '../../hooks/useTabBarClearance';
import { usePwaInsetOvershoot } from '../../hooks/usePwaInsetOvershoot';

// "There is more below". The quests and spots tabs are a stack of
// full-page cards that snap, and the first page is a complete
// screenful: nothing peeks up from under it, so nothing says the page
// goes on. This pill sits just above the
// tab bar with an arrow that bobs downward, in the dog's voice like the
// other hints.
//
// Placed from the tab screen's root, whose bottom edge in an installed
// PWA sits BELOW the visible screen by the home-indicator inset
// (usePwaInsetOvershoot). The first version left that out and sat
// tucked under the tab bar on an iPhone; the bar itself adds it, so
// this does too. Render only while the hint is visible; the parent
// dismisses it on the first scroll.
export function ScrollHintCallout({ text }: { text: string }) {
  const bottom = useTabBarClearance() + usePwaInsetOvershoot();
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        bottom: bottom + S.m,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        // Page-local: the root it sits in is the tab screen, under every
        // sheet and the offline banner (BANNER is above HUD_PILLS).
        zIndex: Z.HUD_PILLS,
        animation: 'hint-scroll-in 240ms ease-out',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: S.s,
          background: VOICE.background,
          color: VOICE.color,
          border: VOICE.border,
          fontFamily: SYSTEM_FONT,
          fontSize: TYPE.small,
          fontWeight: 700,
          padding: `${S.s}px ${S.m}px`,
          borderRadius: R.pill,
          boxShadow: VOICE.shadow,
        }}
      >
        <span>{text}</span>
        <span data-loop style={{ animation: 'hint-scroll-arrow 1s ease-in-out infinite' }}>
          👇
        </span>
      </div>
      <style>{`
        @keyframes hint-scroll-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes hint-scroll-arrow {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(4px); }
        }
      `}</style>
    </div>
  );
}
