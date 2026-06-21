import { useEffect, useState } from 'react';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Z } from '../../constants/z';
import { Icon, type IconName } from './Icon';
import { useStrings } from '../../i18n/useStrings';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

const SHEET_ANIM_MS = 280;

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

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        // Reserve the top for the HUD pills and the bottom for the
        // tab dashboard + iPhone home-indicator. Bumped 100→124px
        // because on PWA users reported the rows list slipping
        // under the dashboard — the previous gap was just enough to
        // clear it but visually felt too tight.
        paddingTop: 80,
        paddingBottom: 'calc(124px + env(safe-area-inset-bottom))' as unknown as number,
        zIndex: Z.MODAL_GLOBAL,
        opacity: closing ? 0 : 1,
        transition: `opacity ${SHEET_ANIM_MS}ms ease-out`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: 24,
          padding: '22px 20px 22px',
          width: '100%',
          maxWidth: 430,
          // Cap to the available flex content area (overlay padding
          // already reserves clearance) so the inner rows scroll
          // instead of the sheet pushing past the HUD.
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          animation: `sheet-${closing ? 'down' : 'up'} ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`,
          boxShadow: '0 -10px 30px rgba(0,0,0,0.12)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <span
            style={{
              background: '#f0f0f0',
              color: '#555',
              borderRadius: 12,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.3,
              textTransform: 'lowercase',
            }}
          >
            {t.modals.about.badge}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#777',
              lineHeight: 1,
            }}
            aria-label={t.modals.common.close}
          >
            ×
          </button>
        </div>

        <div style={{ marginTop: 4, marginBottom: 14 }}>
          <div style={{ fontFamily: SYSTEM_FONT, fontSize: 22, fontWeight: 700 }}>
            {t.modals.about.header}
          </div>
          <div
            style={{ fontSize: 14, color: '#444', marginTop: 6, lineHeight: 1.45 }}
            // Intro contains a <strong> tag for the bot name; render the
            // i18n string as HTML so the markup survives translation.
            dangerouslySetInnerHTML={{ __html: t.modals.about.intro }}
          />
        </div>

        <div
          style={{
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            paddingRight: 4,
          }}
        >
          {t.modals.about.rows.map((r, i) => (
            <div key={r.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  background: '#f5f5f5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                <Icon name={ROW_ICONS[i] ?? 'logo'} size={38} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: SYSTEM_FONT,
                    fontSize: 15,
                    fontWeight: 700,
                    color: '#1a1a1a',
                  }}
                >
                  {r.title}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: '#555',
                    marginTop: 2,
                    lineHeight: 1.45,
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
          @keyframes sheet-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
          @keyframes sheet-down {
            from { transform: translateY(0); }
            to { transform: translateY(100%); }
          }
        `}</style>
      </div>
    </div>
  );
}
