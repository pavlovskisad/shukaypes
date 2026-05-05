import { useEffect, useState } from 'react';
import { SYSTEM_FONT } from '../../constants/fonts';
import { Icon, type IconName } from './Icon';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

const SHEET_ANIM_MS = 280;

interface Row {
  // iconName takes precedence (renders the pixel <Icon>); emoji is
  // the fallback for surfaces we haven't drawn yet.
  iconName?: IconName;
  emoji?: string;
  title: string;
  body: string;
}

// Quick orientation written from шукайпес's voice — sniff sounds, short
// lowercase lines, one row per surface so a first-time visitor can scan
// what's on the map without reading prose. Triggered from the top-left
// logo tap; mirrors the LostDogModal/SpotModal slide-up family.
const ROWS: Row[] = [
  {
    iconName: 'urgent',
    title: 'lost pets',
    body: 'red glow on the map = real missing dogs and cats from olx, telegram, facebook. tap one → start a search → i guide you through 3 waypoints. earn pts when we finish.',
  },
  {
    iconName: 'eyes',
    title: "i've seen them",
    body: 'spotted a missing pet in real life? open them and tap the button — updates the search zone for everyone hunting.',
  },
  {
    iconName: 'paws',
    title: 'paws + bones',
    body: 'i like to eat these. paws scatter near you, bones cluster in parks. fills my hunger meter — keeps me happy on the walk.',
  },
  {
    iconName: 'sun',
    title: 'mood + meters',
    body: 'top-left pills show happiness, hunger, paws collected, plus a pin toggle to hide the cafe pins when the map gets busy.',
  },
  {
    iconName: 'task',
    title: 'daily tasks',
    body: 'small loops — collect paws, check on pets, visit a spot. resets every day so there is always a reason to come back.',
  },
  {
    iconName: 'chat',
    title: 'chat',
    body: 'talk to me about anything. i sniff out other dogs nearby (yes, really), know vet + health stuff when something feels off, help when you need a hand fast, and remember every walk we share.',
  },
  {
    iconName: 'pin',
    title: 'spots',
    body: 'cafés, vets, pet stores, parks near you. tap one → "walk here" plots the route. great when i need to stretch my legs.',
  },
  {
    iconName: 'house',
    title: 'home',
    body: 'your stats. distance walked, paws collected, pets searched, my level + xp.',
  },
];

export function AboutModal({ open, onClose }: AboutModalProps) {
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
        zIndex: 80,
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
            about
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
            aria-label="close"
          >
            ×
          </button>
        </div>

        <div style={{ marginTop: 4, marginBottom: 14 }}>
          <div style={{ fontFamily: SYSTEM_FONT, fontSize: 22, fontWeight: 700 }}>
            *sniff sniff*
          </div>
          <div style={{ fontSize: 14, color: '#444', marginTop: 6, lineHeight: 1.45 }}>
            привіт! i'm <strong>шукайпес</strong> — your companion for finding lost pets in
            kyiv and having good times. we walk, we sniff, we help bring animals home.
            here's what's on the map:
          </div>
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
          {ROWS.map((r) => (
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
                {r.iconName ? <Icon name={r.iconName} size={22} /> : r.emoji}
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
            *tail wag* — when in doubt, just walk. we'll figure the rest out together. 🐾
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
