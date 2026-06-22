import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SYSTEM_FONT } from '../../constants/fonts';
import { INLINE_ICON } from '../../constants/sizing';
import { Icon, type IconName } from './Icon';
import { useStrings } from '../../i18n/useStrings';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

const SHEET_ANIM_MS = 280;
// Top-anchored modal — bump the badge / close button down by the
// safe-area inset so they clear the iPhone notch / status bar.
const SAFE_TOP = 'calc(env(safe-area-inset-top, 0px) + 12px)';

// Icon assignment per about-row index. Stays language-neutral so the
// strings table only carries the translatable title + body — the
// 36px pixel icon for "lost pets" is the same red urgent badge in
// every locale.
const ROW_ICONS: IconName[] = [
  'urgent',
  'eyes',
  'logo',
  'pin',
  'paws',
  'sun',
  'task',
  'chat',
  'pin',
  'house',
];

export function AboutModal({ open, onClose }: AboutModalProps) {
  const t = useStrings();
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  // Same three-state machine as the other sheets so dismiss animates.
  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (rendered && !closing) {
      setClosing(true);
      const t = setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, SHEET_ANIM_MS);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!rendered) return null;
  if (typeof document === 'undefined') return null;

  // Top-sheet modal portaled to document.body so it sits above the
  // HUD pills and the floating dashboard regardless of where in the
  // component tree it gets mounted. Same visual family as the
  // LostDog / Spot modals: full-bleed top edge, rounded bottom only,
  // slides down from off-screen-top.
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 1000,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          borderBottomLeftRadius: 28,
          borderBottomRightRadius: 28,
          padding: 0,
          width: '100%',
          maxWidth: 460,
          // Cap so the content scrolls instead of overlapping the
          // floating dashboard.
          maxHeight: 'calc(100vh - 110px - env(safe-area-inset-bottom))' as unknown as number,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          animation: `top-sheet-${closing ? 'out' : 'in'} ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`,
          boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
          overflow: 'hidden',
        }}
      >
        {/* Header strip — badge top-left, close button top-right.
            Both offset by SAFE_TOP so they clear the iPhone notch
            on a top-anchored modal. */}
        <div
          style={{
            position: 'relative',
            paddingTop: `calc(${SAFE_TOP} + 36px + 8px)`,
            paddingLeft: 22,
            paddingRight: 22,
            paddingBottom: 6,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: SAFE_TOP,
              left: 14,
              background: '#ffffff',
              color: '#555',
              borderRadius: 12,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: 'lowercase',
              boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
              border: '1px solid rgba(0,0,0,0.04)',
            }}
          >
            {t.modals.about.badge}
          </span>
          <button
            onClick={onClose}
            aria-label={t.modals.common.close}
            style={{
              position: 'absolute',
              top: SAFE_TOP,
              right: 12,
              width: 36,
              height: 36,
              borderRadius: 18,
              border: '1px solid rgba(0,0,0,0.06)',
              background: 'rgba(255,255,255,0.92)',
              color: '#1a1a1a',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              fontSize: 26,
              lineHeight: 1,
            }}
          >
            ×
          </button>

          <div style={{ fontFamily: SYSTEM_FONT, fontSize: 26, fontWeight: 800 }}>
            {t.modals.about.header}
          </div>
          <div
            style={{ fontSize: 14, color: '#444', marginTop: 6, lineHeight: 1.45 }}
            // Intro contains a <strong> tag for the bot name; render the
            // i18n string as HTML so the markup survives translation.
            dangerouslySetInnerHTML={{ __html: t.modals.about.intro }}
          />
        </div>

        {/* Scrollable rows */}
        <div
          style={{
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            padding: '14px 22px 22px',
            flexGrow: 1,
            minHeight: 0,
          }}
        >
          {t.modals.about.rows.map((r, i) => (
            <div key={r.title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: INLINE_ICON.about,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingTop: 2,
                }}
              >
                <Icon name={ROW_ICONS[i] ?? 'logo'} size={INLINE_ICON.about} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: SYSTEM_FONT,
                    fontSize: 16,
                    fontWeight: 700,
                    color: '#1a1a1a',
                  }}
                >
                  {r.title}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: '#555',
                    marginTop: 3,
                    lineHeight: 1.5,
                  }}
                >
                  {r.body}
                </div>
              </div>
            </div>
          ))}
          <div
            style={{
              fontSize: 13,
              color: '#777',
              textAlign: 'center',
              marginTop: 6,
              marginBottom: 4,
              fontStyle: 'italic',
            }}
          >
            {t.modals.about.footer}
          </div>
        </div>

        <style>{`
          @keyframes top-sheet-in {
            from { transform: translateY(-100%); }
            to { transform: translateY(0); }
          }
          @keyframes top-sheet-out {
            from { transform: translateY(0); }
            to { transform: translateY(-100%); }
          }
        `}</style>
      </div>
    </div>,
    document.body,
  );
}
